const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const rescueService = require('./rescueService');
const { getFirebaseApp } = require('../config/firebase');

const SOS_PATH = 'sos';
const NOTIFIED_STATE_PATH = 'server_state/notified';
const RESCUE_TEAM_TOPIC = 'rescue_team';

// device_id -> { terminalTimestamp, markedAt }. terminalTimestamp la moc
// (cung khong gian voi Firebase timestamp - epoch ms) ma rescue_event cua
// thiet bi vua chuyen sang RESCUED/CANCELLED. markedAt la thoi diem thuc
// (Date.now()) luc danh dau, dung cho cua so cooldown ben duoi.
const terminalMarks = new Map();

// Chi chan du lieu cu trong 1 khoang ngan sau khi ket thuc cuu ho - du de
// bo qua viec ESP ghi lai payload cache cu ngay lap tuc, nhung khong lam
// tre mot SOS THAT SU moi: qua khoang nay moi du lieu deu duoc chap nhan
// ngay lap tuc, khong con so sanh timestamp nua.
const TERMINAL_COOLDOWN_MS = 15_000;

let currentListener = null;

function parseFirebaseTimestamp(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Chuyen doi 1 child node cua /sos (ghi boi ESP) sang payload tuong thich
// voi rescueService.ingestGps(). Khong throw - tra ve null neu du lieu
// thieu latitude/longitude de tranh crash server.
function mapFirebaseSosToPayload(deviceId, data) {
  if (!data || typeof data !== 'object') return null;
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    device_id: String(data.device_id || deviceId),
    latitude,
    longitude,
    accuracy: data.accuracy == null ? null : Number(data.accuracy),
    sos: true,
    message: data.message == null ? null : String(data.message)
  };
}

function markDeviceTerminal(deviceId, timestampMs = Date.now()) {
  terminalMarks.set(deviceId, { terminalTimestamp: timestampMs, markedAt: Date.now() });
}

function clearDeviceTerminal(deviceId) {
  terminalMarks.delete(deviceId);
}

// Firebase SOS duoc coi la du lieu cu (ESP ghi lai payload cache truoc do)
// chi khi CA HAI dieu kien dung: (1) van con trong cua so cooldown ngan
// sau khi ket thuc cuu ho, VA (2) timestamp cua no <= moc terminal. Qua
// cooldown, moi du lieu duoc chap nhan ngay - dam bao SOS moi khong bao
// gio bi tre vi lech dong ho thiet bi.
function isStaleAfterTerminal(deviceId, timestampMs) {
  const mark = terminalMarks.get(deviceId);
  if (!mark) return false;
  if (Date.now() - mark.markedAt > TERMINAL_COOLDOWN_MS) {
    terminalMarks.delete(deviceId);
    return false;
  }
  if (timestampMs == null) return false;
  return timestampMs <= mark.terminalTimestamp;
}

function emitIngestResult(io, result) {
  if (!io) return;
  const update = {
    device_id: result.data.deviceId,
    latitude: result.data.latitude,
    longitude: result.data.longitude,
    accuracy: result.data.accuracy,
    battery: result.data.battery,
    rssi: result.data.rssi,
    event_id: result.event?.id || null,
    status: result.event?.status || null,
    created_at: new Date().toISOString()
  };
  io.emit('gps:update', update);
  if (result.event) io.emit(result.isNewEvent ? 'rescue:new' : 'rescue:update', result.event);
}

// ======================================================
// FIREBASE CLOUD MESSAGING (canh bao SOS cho doi cuu ho)
// ======================================================

async function getNotifiedFlag(app, deviceId) {
  const snapshot = await getDatabase(app).ref(`${NOTIFIED_STATE_PATH}/${deviceId}`).get();
  return snapshot.exists() && snapshot.val() === true;
}

async function setNotifiedFlag(app, deviceId, value) {
  const ref = getDatabase(app).ref(`${NOTIFIED_STATE_PATH}/${deviceId}`);
  if (value) await ref.set(true);
  else await ref.remove();
}

async function sendSosNotification(app, deviceId, payload, rawTimestamp, logger) {
  const messageText = payload.message && String(payload.message).trim() ? String(payload.message).trim() : 'Can cuu ho';
  await getMessaging(app).send({
    topic: RESCUE_TEAM_TOPIC,
    notification: {
      title: 'CÓ YÊU CẦU CỨU HỘ',
      body: `${deviceId}: ${messageText}`
    },
    data: {
      type: 'SOS',
      device_id: deviceId,
      latitude: String(payload.latitude),
      longitude: String(payload.longitude),
      accuracy: payload.accuracy == null ? '' : String(payload.accuracy),
      message: messageText,
      timestamp: String(rawTimestamp ?? Date.now())
    },
    android: {
      priority: 'high',
      notification: { channelId: 'rescue_alerts' }
    }
  });
  logger.info?.(`[FCM] Da gui canh bao SOS toi topic ${RESCUE_TEAM_TOPIC} device=${deviceId}`);
}

// Gui FCM dung 1 lan cho moi dot SOS. Dung /server_state/notified/{deviceId}
// (KHONG phai field trong /sos/{deviceId}) vi ESP PUT de nguyen node /sos
// moi lan cap nhat GPS, se xoa mat moi field tu them vao. Neu gui that bai
// (mang loi...) co la duoc giu false, lan cap nhat GPS tiep theo (child_changed)
// se tu dong thu gui lai - khong can co che retry rieng.
async function maybeNotifyNewSos(app, deviceId, payload, rawTimestamp, logger) {
  if (!app) return;
  try {
    if (await getNotifiedFlag(app, deviceId)) return;
    await sendSosNotification(app, deviceId, payload, rawTimestamp, logger);
    await setNotifiedFlag(app, deviceId, true);
  } catch (error) {
    logger.warn?.(`[FCM] Gui canh bao SOS that bai device=${deviceId}: ${error.message} (se tu thu lai o lan cap nhat GPS tiep theo)`);
  }
}

function defaultNotify(app) {
  return async (deviceId, payload, rawTimestamp, logger) => {
    await maybeNotifyNewSos(app, deviceId, payload, rawTimestamp, logger);
  };
}

// Tao 1 bo xu ly su kien Firebase, khong phu thuoc truc tiep vao
// firebase-admin nen co the unit test bang cach goi thang voi du lieu gia.
// `notify` co the duoc thay the trong test de kiem tra logic "chi gui 1 lan"
// ma khong can ket noi FCM/Firebase that.
function createSosHandlers({ io, logger = console, service = rescueService, notify = async () => {} } = {}) {
  async function upsertFromFirebase(deviceId, data, eventLabel) {
    if (!data) return;
    // ESP luon ghi status "waiting" cho moi lan cap nhat GPS (xem spec /sos).
    // Backend (rescueActionsService, rescueController) cung ghi vao cung
    // node nay de cap nhat status = confirmed/rescuing/rescued/failed -
    // BO QUA nhung ghi do o day, neu khong se tu kich hoat lai chinh minh:
    // ghi status=rescued -> listener nay thay child_changed -> tuong la
    // GPS moi -> "hoi sinh" mot su kien da RESCUED thanh SOS moi.
    const rawStatus = typeof data.status === 'string' ? data.status.toLowerCase() : null;
    if (rawStatus != null && rawStatus !== 'waiting') {
      logger.info?.(`[FirebaseSOS] Bo qua ${eventLabel} device=${deviceId} vi status="${rawStatus}" (khong phai du lieu GPS tu ESP)`);
      return;
    }

    const timestamp = parseFirebaseTimestamp(data.timestamp);
    if (data.timestamp != null && timestamp == null) {
      logger.warn?.(`[FirebaseSOS] timestamp khong hop le device=${deviceId} raw=${data.timestamp}`);
    }

    if (isStaleAfterTerminal(deviceId, timestamp)) {
      logger.warn?.(`[FirebaseSOS] Bo qua du lieu cu tu ESP (${eventLabel}) device=${deviceId}, timestamp<=terminal`);
      return;
    }

    const payload = mapFirebaseSosToPayload(deviceId, data);
    if (!payload) {
      logger.warn?.(`[FirebaseSOS] Du lieu thieu latitude/longitude, bo qua (${eventLabel}) device=${deviceId}`);
      return;
    }

    try {
      const result = await service.ingestGps(payload);
      // SOS moi da duoc tao that su - khong con can canh giac du lieu cu
      // cho thiet bi nay nua, xoa moc terminal de tranh moi anh huong
      // (du la truong hop hiem) den cac lan cap nhat vi tri tiep theo.
      if (result.isNewEvent) clearDeviceTerminal(deviceId);
      emitIngestResult(io, result);
      logger.info?.(`[FirebaseSOS] ${eventLabel} device=${deviceId} eventId=${result.event?.id || '-'} isNew=${result.isNewEvent}`);
      // Chi canh bao doi cuu ho khi trang thai van la SOS moi/dang cho
      // (chua CONFIRMED/RESCUING/RESCUED/CANCELLED) - tranh spam khi ESP
      // tiep tuc PUT toa do sau khi nhiem vu da duoc tiep nhan.
      if (result.event?.status === 'SOS') {
        await notify(deviceId, payload, data.timestamp, logger);
      }
    } catch (error) {
      logger.error?.(`[FirebaseSOS] Loi xu ly ${eventLabel} device=${deviceId}: ${error.message}`);
    }
  }

  async function handleChildAdded(deviceId, data) {
    await upsertFromFirebase(deviceId, data, 'child_added');
  }

  async function handleChildChanged(deviceId, data) {
    await upsertFromFirebase(deviceId, data, 'child_changed');
  }

  function handleChildRemoved(deviceId) {
    // Chi log - KHONG xoa rescue_event/location_history trong MySQL.
    // MySQL la nguon luu lich su lau dai, doc lap voi Firebase.
    logger.info?.(`[FirebaseSOS] /sos/${deviceId} da bi xoa khoi Firebase (khong dong bo xoa MySQL)`);
  }

  return { handleChildAdded, handleChildChanged, handleChildRemoved };
}

// Bat dau lang nghe realtime tai /sos. Idempotent: neu da co listener dang
// chay (vi du Electron restart server noi bo), listener cu se duoc go bo
// truoc khi gan listener moi, tranh nhan trung su kien.
async function startFirebaseSosListener({ io, logger = console, service = rescueService } = {}) {
  if (currentListener) {
    await currentListener.stop();
    currentListener = null;
  }

  const app = getFirebaseApp(logger);
  if (!app) {
    logger.warn?.('[FirebaseSOS] Firebase chua duoc cau hinh, listener realtime bi vo hieu hoa.');
    return { async stop() {} };
  }

  const handlers = createSosHandlers({ io, logger, service, notify: defaultNotify(app) });
  const database = getDatabase(app);
  database.goOnline();
  const ref = database.ref(SOS_PATH);

  const onAdded = (snapshot) => { handlers.handleChildAdded(snapshot.key, snapshot.val()); };
  const onChanged = (snapshot) => { handlers.handleChildChanged(snapshot.key, snapshot.val()); };
  const onRemoved = (snapshot) => { handlers.handleChildRemoved(snapshot.key); };

  ref.on('child_added', onAdded, (error) => logger.error?.(`[FirebaseSOS] child_added loi: ${error.message}`));
  ref.on('child_changed', onChanged, (error) => logger.error?.(`[FirebaseSOS] child_changed loi: ${error.message}`));
  ref.on('child_removed', onRemoved, (error) => logger.error?.(`[FirebaseSOS] child_removed loi: ${error.message}`));

  logger.info?.(`[FirebaseSOS] Dang lang nghe realtime tai /${SOS_PATH}`);

  currentListener = {
    // Chi go listener khoi ref - KHONG dong Firebase Admin app o day, vi
    // rescueActionsService co the dang dung chung 1 app. Viec dong app
    // hoan toan (tranh treo tien trinh) do server/app.js dieu phoi sau khi
    // moi listener Firebase da duoc dung.
    async stop() {
      ref.off('child_added', onAdded);
      ref.off('child_changed', onChanged);
      ref.off('child_removed', onRemoved);
      logger.info?.('[FirebaseSOS] Da dung listener realtime /sos');
    }
  };
  return currentListener;
}

// Xoa /sos/{deviceId} khoi Firebase. Chi nen goi khi rescue_event tuong ung
// vua chuyen sang trang thai cuoi cung (mac dinh: RESCUED hoac CANCELLED).
// Danh mot moc thoi gian "terminal" cho device de chan viec ESP ghi lai
// du lieu cu tao ra SOS gia sau khi da ket thuc. Cung xoa co "notified"
// de mot dot SOS THAT SU moi sau nay cho thiet bi nay duoc canh bao lai.
async function removeFirebaseSos(deviceId, logger = console) {
  markDeviceTerminal(deviceId);
  const app = getFirebaseApp(logger);
  if (!app) return false;
  try {
    const database = getDatabase(app);
    database.goOnline();
    await database.ref(`${SOS_PATH}/${deviceId}`).remove();
    await database.ref(`${NOTIFIED_STATE_PATH}/${deviceId}`).remove();
    logger.info?.(`[FirebaseSOS] Da xoa /sos/${deviceId} khoi Firebase`);
    return true;
  } catch (error) {
    logger.warn?.(`[FirebaseSOS] Khong the xoa /sos/${deviceId}: ${error.message}`);
    return false;
  }
}

// Cap nhat /sos/{deviceId}/status (va cac field lien quan) ma KHONG xoa
// ca node - dung cho CONFIRMED/RESCUING de app doi cuu ho thay trang thai
// realtime trong khi ESP van tiep tuc cap nhat GPS vao cung node do.
async function updateFirebaseSosStatus(deviceId, fields, logger = console) {
  const app = getFirebaseApp(logger);
  if (!app) return false;
  try {
    const database = getDatabase(app);
    database.goOnline();
    await database.ref(`${SOS_PATH}/${deviceId}`).update(fields);
    return true;
  } catch (error) {
    logger.warn?.(`[FirebaseSOS] Khong the cap nhat /sos/${deviceId}: ${error.message}`);
    return false;
  }
}

// Quy tac hien tai: chi xoa Firebase khi trang thai cuoi la RESCUED hoac
// CANCELLED. De thay doi sau nay (vi du xoa ngay khi CONFIRMED), chi can
// sua danh sach nay - phan con lai cua he thong khong doi.
const FIREBASE_CLEANUP_STATUSES = new Set(['RESCUED', 'CANCELLED']);

function shouldRemoveFirebaseOnTransition(targetStatus) {
  return FIREBASE_CLEANUP_STATUSES.has(targetStatus);
}

async function stopFirebaseSosListener() {
  if (currentListener) {
    const listener = currentListener;
    currentListener = null;
    await listener.stop();
  }
}

// Chi danh cho test.
async function _resetForTest() {
  terminalMarks.clear();
  await stopFirebaseSosListener();
}

module.exports = {
  mapFirebaseSosToPayload,
  parseFirebaseTimestamp,
  isStaleAfterTerminal,
  markDeviceTerminal,
  clearDeviceTerminal,
  createSosHandlers,
  startFirebaseSosListener,
  stopFirebaseSosListener,
  removeFirebaseSos,
  updateFirebaseSosStatus,
  shouldRemoveFirebaseOnTransition,
  FIREBASE_CLEANUP_STATUSES,
  TERMINAL_COOLDOWN_MS,
  RESCUE_TEAM_TOPIC,
  _resetForTest
};
