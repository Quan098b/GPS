const { getPool } = require('../config/database');

const ACTIVE_STATUSES = ['SOS', 'CONFIRMED', 'RESCUING'];
const VALID_TRANSITIONS = Object.freeze({
  SOS: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['RESCUING', 'CANCELLED'],
  RESCUING: ['RESCUED', 'CANCELLED'],
  RESCUED: [],
  CANCELLED: []
});

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateGpsPayload(body) {
  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = body.accuracy == null ? null : Number(body.accuracy);
  const battery = body.battery == null ? null : Number(body.battery);
  const rssi = body.rssi == null ? null : Number(body.rssi);

  if (!deviceId || deviceId.length > 100) throw httpError(400, 'device_id la bat buoc va toi da 100 ky tu');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw httpError(400, 'latitude phai tu -90 den 90');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw httpError(400, 'longitude phai tu -180 den 180');
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) throw httpError(400, 'accuracy khong hop le');
  if (battery !== null && (!Number.isInteger(battery) || battery < 0 || battery > 100)) throw httpError(400, 'battery phai tu 0 den 100');
  if (rssi !== null && (!Number.isInteger(rssi) || rssi < -200 || rssi > 100)) throw httpError(400, 'rssi khong hop le');

  return {
    deviceId,
    latitude,
    longitude,
    accuracy,
    battery,
    rssi,
    sos: body.sos === true || body.sos === 1 || String(body.sos).toLowerCase() === 'true',
    message: body.message == null ? null : String(body.message).slice(0, 500)
  };
}

function assertTransition(currentStatus, targetStatus) {
  if (!VALID_TRANSITIONS[currentStatus]?.includes(targetStatus)) {
    throw httpError(409, `Khong the chuyen tu ${currentStatus} sang ${targetStatus}`);
  }
}

async function ingestGps(payload) {
  const data = validateGpsPayload(payload);
  const pool = getPool();
  const connection = await pool.getConnection();
  let event = null;
  let isNewEvent = false;

  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO devices (device_id, last_latitude, last_longitude, last_seen, battery, rssi)
       VALUES (?, ?, ?, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE last_latitude = VALUES(last_latitude),
         last_longitude = VALUES(last_longitude), last_seen = NOW(),
         battery = VALUES(battery), rssi = VALUES(rssi)`,
      [data.deviceId, data.latitude, data.longitude, data.battery, data.rssi]
    );

    if (data.sos) {
      const [active] = await connection.execute(
        `SELECT * FROM rescue_events
         WHERE device_id = ? AND status IN ('SOS','CONFIRMED','RESCUING')
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [data.deviceId]
      );

      if (active.length) {
        await connection.execute(
          `UPDATE rescue_events SET latitude = ?, longitude = ?, accuracy = ?,
             battery = ?, rssi = ?, message = COALESCE(?, message) WHERE id = ?`,
          [data.latitude, data.longitude, data.accuracy, data.battery, data.rssi, data.message, active[0].id]
        );
        event = { ...active[0], latitude: data.latitude, longitude: data.longitude, accuracy: data.accuracy, battery: data.battery, rssi: data.rssi, message: data.message ?? active[0].message };
      } else {
        const [result] = await connection.execute(
          `INSERT INTO rescue_events
             (device_id, latitude, longitude, accuracy, battery, rssi, message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [data.deviceId, data.latitude, data.longitude, data.accuracy, data.battery, data.rssi, data.message]
        );
        const [created] = await connection.execute('SELECT * FROM rescue_events WHERE id = ?', [result.insertId]);
        event = created[0];
        isNewEvent = true;
      }
    }

    await connection.execute(
      `INSERT INTO location_history
         (device_id, rescue_event_id, latitude, longitude, accuracy, battery, rssi)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.deviceId, event?.id || null, data.latitude, data.longitude, data.accuracy, data.battery, data.rssi]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { data, event, isNewEvent };
}

async function listRescues(filters = {}) {
  const pool = getPool();
  const where = [];
  const params = [];
  if (filters.status) {
    const statuses = String(filters.status).split(',').map((value) => value.trim().toUpperCase());
    if (statuses.some((status) => !Object.hasOwn(VALID_TRANSITIONS, status))) throw httpError(400, 'status khong hop le');
    where.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (filters.device) {
    where.push('r.device_id LIKE ?');
    params.push(`%${String(filters.device).slice(0, 100)}%`);
  }
  if (filters.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) throw httpError(400, 'date phai co dang YYYY-MM-DD');
    where.push('DATE(r.created_at) = ?');
    params.push(filters.date);
  }

  const [rows] = await pool.execute(
    `SELECT r.*, d.device_name, d.last_seen,
       (d.last_seen >= NOW() - INTERVAL 2 MINUTE) AS device_online
     FROM rescue_events r LEFT JOIN devices d ON d.device_id = r.device_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY FIELD(r.status, 'SOS','CONFIRMED','RESCUING','RESCUED','CANCELLED'), r.created_at DESC
     LIMIT 1000`,
    params
  );
  return rows;
}

async function getRescue(id) {
  const pool = getPool();
  const [events] = await pool.execute(
    `SELECT r.*, d.device_name, d.last_seen,
       (d.last_seen >= NOW() - INTERVAL 2 MINUTE) AS device_online
     FROM rescue_events r LEFT JOIN devices d ON d.device_id = r.device_id WHERE r.id = ?`,
    [id]
  );
  if (!events.length) throw httpError(404, 'Su kien cuu ho khong ton tai');
  const [history] = await pool.execute(
    'SELECT * FROM location_history WHERE rescue_event_id = ? ORDER BY created_at ASC',
    [id]
  );
  return { ...events[0], history };
}

async function transitionRescue(id, targetStatus, confirmedBy = null) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM rescue_events WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) throw httpError(404, 'Su kien cuu ho khong ton tai');
    const event = rows[0];
    assertTransition(event.status, targetStatus);

    const fields = ['status = ?'];
    const params = [targetStatus];
    if (targetStatus === 'CONFIRMED') {
      const name = typeof confirmedBy === 'string' ? confirmedBy.trim() : '';
      if (!name) throw httpError(400, 'confirmed_by la bat buoc');
      fields.push('confirmed_at = NOW()', 'confirmed_by = ?');
      params.push(name.slice(0, 255));
    }
    if (targetStatus === 'RESCUING') fields.push('rescuing_at = NOW()');
    if (targetStatus === 'RESCUED') fields.push('rescued_at = NOW()');
    params.push(id);
    await connection.execute(`UPDATE rescue_events SET ${fields.join(', ')} WHERE id = ?`, params);
    await connection.commit();
    return getRescue(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Tim rescue_event dang hoat dong (SOS/CONFIRMED/RESCUING) gan nhat theo
// device_id. Dung boi rescueActionsService de tim event MySQL tuong ung
// mot action tu app doi cuu ho, vi app chi biet device_id (tu Firebase),
// khong biet rescue_event.id cua MySQL.
async function getActiveRescueByDeviceId(deviceId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT * FROM rescue_events
     WHERE device_id = ? AND status IN ('SOS','CONFIRMED','RESCUING')
     ORDER BY created_at DESC LIMIT 1`,
    [deviceId]
  );
  return rows[0] || null;
}

async function getDeviceSummary() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total,
       SUM(last_seen >= NOW() - INTERVAL 2 MINUTE) AS online
     FROM devices`
  );
  return { total: Number(rows[0].total || 0), online: Number(rows[0].online || 0) };
}

module.exports = {
  ACTIVE_STATUSES,
  VALID_TRANSITIONS,
  validateGpsPayload,
  assertTransition,
  ingestGps,
  listRescues,
  getRescue,
  transitionRescue,
  getActiveRescueByDeviceId,
  getDeviceSummary
};
