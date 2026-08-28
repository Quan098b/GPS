const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapFirebaseSosToPayload,
  parseFirebaseTimestamp,
  isStaleAfterTerminal,
  markDeviceTerminal,
  clearDeviceTerminal,
  createSosHandlers,
  shouldRemoveFirebaseOnTransition,
  _resetForTest
} = require('../server/services/firebaseSosService');

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function fakeIo() {
  const emitted = [];
  return { emitted, emit(event, data) { emitted.push({ event, data }); } };
}

test('mapFirebaseSosToPayload converts a Firebase SOS node into an ingestGps payload', () => {
  const payload = mapFirebaseSosToPayload('RESCUE-001', {
    device_id: 'RESCUE-001',
    latitude: 21.590408,
    longitude: 105.801682,
    accuracy: 4.3,
    message: 'heee',
    status: 'waiting',
    timestamp: '1787868150154'
  });
  assert.deepEqual(payload, {
    device_id: 'RESCUE-001',
    latitude: 21.590408,
    longitude: 105.801682,
    accuracy: 4.3,
    sos: true,
    message: 'heee'
  });
});

test('mapFirebaseSosToPayload returns null when latitude/longitude are missing (no crash)', () => {
  assert.equal(mapFirebaseSosToPayload('RESCUE-001', { device_id: 'RESCUE-001', message: 'x' }), null);
  assert.equal(mapFirebaseSosToPayload('RESCUE-001', null), null);
  assert.equal(mapFirebaseSosToPayload('RESCUE-001', { latitude: 'abc', longitude: 105 }), null);
});

test('parseFirebaseTimestamp safely parses string timestamps', () => {
  assert.equal(parseFirebaseTimestamp('1787868150154'), 1787868150154);
  assert.equal(parseFirebaseTimestamp(1787868150154), 1787868150154);
  assert.equal(parseFirebaseTimestamp('not-a-number'), null);
  assert.equal(parseFirebaseTimestamp(undefined), null);
});

test('child_added ingests GPS and emits rescue:new for a brand new event', async () => {
  _resetForTest();
  const io = fakeIo();
  const service = {
    async ingestGps(payload) {
      return {
        data: { deviceId: payload.device_id, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, battery: null, rssi: null },
        event: { id: 1, device_id: payload.device_id, status: 'SOS' },
        isNewEvent: true
      };
    }
  };
  const handlers = createSosHandlers({ io, logger: silentLogger(), service });
  await handlers.handleChildAdded('RESCUE-001', {
    device_id: 'RESCUE-001', latitude: 21.5, longitude: 105.8, accuracy: 4.3, message: 'heee', status: 'waiting', timestamp: '1000'
  });
  assert.ok(io.emitted.some((entry) => entry.event === 'gps:update'));
  assert.ok(io.emitted.some((entry) => entry.event === 'rescue:new'));
  assert.ok(!io.emitted.some((entry) => entry.event === 'rescue:update'));
});

test('child_changed only updates the active event for RESCUE-001 (no duplicate creation)', async () => {
  _resetForTest();
  const io = fakeIo();
  const service = {
    async ingestGps(payload) {
      return {
        data: { deviceId: payload.device_id, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, battery: null, rssi: null },
        event: { id: 7, device_id: payload.device_id, status: 'SOS' },
        isNewEvent: false
      };
    }
  };
  const handlers = createSosHandlers({ io, logger: silentLogger(), service });
  await handlers.handleChildChanged('RESCUE-001', {
    device_id: 'RESCUE-001', latitude: 21.6, longitude: 105.9, accuracy: 3.1, message: 'moi cap nhat', status: 'waiting', timestamp: '2000'
  });
  assert.ok(io.emitted.some((entry) => entry.event === 'gps:update'));
  assert.ok(io.emitted.some((entry) => entry.event === 'rescue:update'));
  assert.ok(!io.emitted.some((entry) => entry.event === 'rescue:new'));
});

test('child_removed only logs, never touches MySQL', () => {
  _resetForTest();
  let ingestCalled = false;
  const service = { async ingestGps() { ingestCalled = true; } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });
  handlers.handleChildRemoved('RESCUE-001');
  assert.equal(ingestCalled, false);
});

test('malformed Firebase data (missing latitude/longitude) does not throw and does not call ingestGps', async () => {
  _resetForTest();
  let ingestCalled = false;
  const service = { async ingestGps() { ingestCalled = true; } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });
  await assert.doesNotReject(handlers.handleChildAdded('RESCUE-002', { device_id: 'RESCUE-002', message: 'no gps' }));
  assert.equal(ingestCalled, false);
});

test('ingestGps errors are caught and logged, they do not propagate', async () => {
  _resetForTest();
  const service = { async ingestGps() { throw new Error('MySQL down'); } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });
  await assert.doesNotReject(handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, timestamp: '1000' }));
});

test('Firebase data resent after a terminal event (RESCUED/CANCELLED) is ignored by timestamp', async () => {
  _resetForTest();
  markDeviceTerminal('RESCUE-001', 5000);
  let ingestCalled = false;
  const service = { async ingestGps() { ingestCalled = true; } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });

  // Payload cu (timestamp <= moc terminal) bi bo qua
  await handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, timestamp: '4000' });
  assert.equal(ingestCalled, false);

  // Payload moi (timestamp > moc terminal, SOS that su moi) van duoc xu ly
  await handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, timestamp: '6000' });
  assert.equal(ingestCalled, true);
});

test('isStaleAfterTerminal / markDeviceTerminal behave correctly on the boundary', () => {
  _resetForTest();
  assert.equal(isStaleAfterTerminal('RESCUE-001', 100), false);
  markDeviceTerminal('RESCUE-001', 1000);
  assert.equal(isStaleAfterTerminal('RESCUE-001', 1000), true);
  assert.equal(isStaleAfterTerminal('RESCUE-001', 999), true);
  assert.equal(isStaleAfterTerminal('RESCUE-001', 1001), false);
});

test('once a new rescue event is created, the terminal guard is cleared so later updates are never delayed', async () => {
  _resetForTest();
  markDeviceTerminal('RESCUE-001', 9000);
  let ingestCount = 0;
  const service = {
    async ingestGps() {
      ingestCount += 1;
      return {
        data: { deviceId: 'RESCUE-001', latitude: 21.5, longitude: 105.8, accuracy: null, battery: null, rssi: null },
        event: { id: 42, device_id: 'RESCUE-001', status: 'SOS' },
        isNewEvent: ingestCount === 1
      };
    }
  };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });

  // SOS moi that su (timestamp > terminal) duoc chap nhan va xoa moc terminal
  await handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, timestamp: '9500' });
  assert.equal(ingestCount, 1);

  // Cap nhat tiep theo cua chinh SOS nay, du timestamp thap hon moc terminal
  // cu, van phai duoc xu ly ngay (khong con bi chan nua) - dam bao khong delay.
  await handlers.handleChildChanged('RESCUE-001', { latitude: 21.55, longitude: 105.85, timestamp: '8000' });
  assert.equal(ingestCount, 2);
});

test('clearDeviceTerminal immediately lifts the stale guard for a device', () => {
  _resetForTest();
  markDeviceTerminal('RESCUE-001', 5000);
  assert.equal(isStaleAfterTerminal('RESCUE-001', 4000), true);
  clearDeviceTerminal('RESCUE-001');
  assert.equal(isStaleAfterTerminal('RESCUE-001', 4000), false);
});

test('notify (FCM) is called once for a brand-new SOS event but not for later GPS-only updates', async () => {
  _resetForTest();
  const notifyCalls = [];
  const service = {
    async ingestGps(payload) {
      return {
        data: { deviceId: payload.device_id, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, battery: null, rssi: null },
        event: { id: 3, device_id: payload.device_id, status: 'SOS' },
        isNewEvent: true
      };
    }
  };
  const notify = async (deviceId, payload, rawTimestamp) => { notifyCalls.push({ deviceId, payload, rawTimestamp }); };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service, notify });

  await handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, message: 'heee', timestamp: '1000' });
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].deviceId, 'RESCUE-001');
  assert.equal(notifyCalls[0].payload.message, 'heee');
});

test('notify (FCM) is NOT called once the rescue event has moved past SOS (CONFIRMED/RESCUING/...)', async () => {
  _resetForTest();
  const notifyCalls = [];
  const service = {
    async ingestGps(payload) {
      return {
        data: { deviceId: payload.device_id, latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, battery: null, rssi: null },
        event: { id: 3, device_id: payload.device_id, status: 'CONFIRMED' },
        isNewEvent: false
      };
    }
  };
  const notify = async (deviceId) => { notifyCalls.push(deviceId); };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service, notify });

  await handlers.handleChildChanged('RESCUE-001', { latitude: 21.55, longitude: 105.85, timestamp: '2000' });
  assert.equal(notifyCalls.length, 0);
});

test('a /sos status write made by the backend itself (status != "waiting") is ignored, not re-ingested as GPS', async () => {
  _resetForTest();
  let ingestCalled = false;
  const service = { async ingestGps() { ingestCalled = true; } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });

  // rescueActionsService.updateFirebaseSosStatus() writes exactly this shape
  // to /sos/{deviceId} (status only, no fresh latitude/longitude) - it must
  // not be mistaken for a new GPS ping from the ESP and resurrect the event.
  await handlers.handleChildChanged('RESCUE-001', {
    device_id: 'RESCUE-001', latitude: 21.5, longitude: 105.8, message: 'heee', status: 'rescued', timestamp: '9999'
  });
  assert.equal(ingestCalled, false);
});

test('an ESP GPS write (status "waiting") is still ingested normally', async () => {
  _resetForTest();
  let ingestCalled = false;
  const service = { async ingestGps() { ingestCalled = true; return { data: {}, event: { status: 'SOS' }, isNewEvent: true }; } };
  const handlers = createSosHandlers({ io: fakeIo(), logger: silentLogger(), service });

  await handlers.handleChildAdded('RESCUE-001', { latitude: 21.5, longitude: 105.8, status: 'waiting', timestamp: '1000' });
  assert.equal(ingestCalled, true);
});

test('shouldRemoveFirebaseOnTransition only removes Firebase SOS for RESCUED/CANCELLED', () => {
  assert.equal(shouldRemoveFirebaseOnTransition('RESCUED'), true);
  assert.equal(shouldRemoveFirebaseOnTransition('CANCELLED'), true);
  assert.equal(shouldRemoveFirebaseOnTransition('CONFIRMED'), false);
  assert.equal(shouldRemoveFirebaseOnTransition('RESCUING'), false);
  assert.equal(shouldRemoveFirebaseOnTransition('SOS'), false);
});
