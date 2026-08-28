const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAction, createActionHandlers, _resetForTest } = require('../server/services/rescueActionsService');

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function fakeIo() {
  const emitted = [];
  return { emitted, emit(event, data) { emitted.push({ event, data }); } };
}

test('normalizeAction accepts known actions and defaults team_id', () => {
  assert.deepEqual(normalizeAction({ action: 'confirm' }), { action: 'CONFIRM', teamId: 'RESCUE-TEAM-01', reason: null, timestamp: null });
  assert.deepEqual(
    normalizeAction({ action: 'START_RESCUE', team_id: 'TEAM-X', timestamp: 555 }),
    { action: 'START_RESCUE', teamId: 'TEAM-X', reason: null, timestamp: 555 }
  );
  assert.equal(normalizeAction({ action: 'not_a_real_action' }), null);
  assert.equal(normalizeAction(null), null);
  assert.equal(normalizeAction({}), null);
});

test('normalizeAction keeps a trimmed reason for FAILED actions', () => {
  const action = normalizeAction({ action: 'FAILED', reason: '  Khong tiep can duoc  ' });
  assert.equal(action.reason, 'Khong tiep can duoc');
});

test('CONFIRM action transitions SOS -> CONFIRMED, emits rescue:update, updates Firebase status', async () => {
  await _resetForTest();
  const io = fakeIo();
  const firebaseUpdates = [];
  const service = {
    async getActiveRescueByDeviceId(deviceId) {
      return { id: 10, device_id: deviceId, status: 'SOS' };
    },
    async transitionRescue(id, targetStatus, confirmedBy) {
      assert.equal(id, 10);
      assert.equal(targetStatus, 'CONFIRMED');
      assert.equal(confirmedBy, 'RESCUE-TEAM-01');
      return { id, device_id: 'RESCUE-001', status: targetStatus };
    }
  };
  const cleared = [];
  const handlers = createActionHandlers({
    io,
    logger: silentLogger(),
    service,
    removeSos: async () => true,
    updateSosStatus: async (deviceId, fields) => { firebaseUpdates.push({ deviceId, fields }); },
    clearAction: async (deviceId) => cleared.push(deviceId)
  });

  await handlers.processAction('RESCUE-001', { action: 'CONFIRM', team_id: 'RESCUE-TEAM-01' });

  assert.equal(io.emitted.length, 1);
  assert.equal(io.emitted[0].event, 'rescue:update');
  assert.equal(io.emitted[0].data.status, 'CONFIRMED');
  assert.equal(firebaseUpdates.length, 1);
  assert.equal(firebaseUpdates[0].fields.status, 'confirmed');
  assert.deepEqual(cleared, ['RESCUE-001']);
});

test('RESCUED action removes Firebase SOS (after writing the final status) and never CONFIRM/RESCUING fields', async () => {
  await _resetForTest();
  const removed = [];
  const firebaseUpdates = [];
  const service = {
    async getActiveRescueByDeviceId() { return { id: 11, device_id: 'RESCUE-001', status: 'RESCUING' }; },
    async transitionRescue(id, targetStatus) { return { id, device_id: 'RESCUE-001', status: targetStatus }; }
  };
  const handlers = createActionHandlers({
    io: fakeIo(),
    logger: silentLogger(),
    service,
    removeSos: async (deviceId) => { removed.push(deviceId); return true; },
    updateSosStatus: async (deviceId, fields) => { firebaseUpdates.push({ deviceId, fields }); },
    clearAction: async () => {}
  });

  await handlers.processAction('RESCUE-001', { action: 'RESCUED', team_id: 'RESCUE-TEAM-01' });
  // removeSos is scheduled with a short delay (CLEANUP_DELAY_MS) so the app
  // can render the final state first - it should not have fired yet.
  assert.equal(removed.length, 0);
  assert.equal(firebaseUpdates.length, 1);
  assert.equal(firebaseUpdates[0].fields.status, 'rescued');
});

test('FAILED action stores the reason and marks the Firebase status as failed', async () => {
  await _resetForTest();
  const firebaseUpdates = [];
  const service = {
    async getActiveRescueByDeviceId() { return { id: 12, device_id: 'RESCUE-001', status: 'RESCUING' }; },
    async transitionRescue(id, targetStatus) { return { id, device_id: 'RESCUE-001', status: targetStatus }; }
  };
  const handlers = createActionHandlers({
    io: fakeIo(),
    logger: silentLogger(),
    service,
    removeSos: async () => true,
    updateSosStatus: async (deviceId, fields) => { firebaseUpdates.push({ deviceId, fields }); },
    clearAction: async () => {}
  });

  await handlers.processAction('RESCUE-001', { action: 'FAILED', reason: 'Khong tim thay nan nhan' });
  const finalUpdate = firebaseUpdates.find((entry) => entry.fields.status === 'failed');
  assert.ok(finalUpdate);
  assert.equal(finalUpdate.fields.reason, 'Khong tim thay nan nhan');
});

test('unknown action is ignored (action node still cleared, nothing crashes)', async () => {
  await _resetForTest();
  const cleared = [];
  const service = { async getActiveRescueByDeviceId() { throw new Error('should not be called'); } };
  const handlers = createActionHandlers({
    io: fakeIo(),
    logger: silentLogger(),
    service,
    clearAction: async (deviceId) => cleared.push(deviceId)
  });

  await assert.doesNotReject(handlers.processAction('RESCUE-001', { action: 'BOGUS' }));
  assert.deepEqual(cleared, ['RESCUE-001']);
});

test('action for a device with no active rescue event is ignored without throwing', async () => {
  await _resetForTest();
  const service = { async getActiveRescueByDeviceId() { return null; } };
  const handlers = createActionHandlers({ io: fakeIo(), logger: silentLogger(), service, clearAction: async () => {} });
  await assert.doesNotReject(handlers.processAction('RESCUE-999', { action: 'CONFIRM' }));
});

test('the exact same action (same device+action+timestamp) delivered twice is only processed once', async () => {
  await _resetForTest();
  let transitionCalls = 0;
  const service = {
    async getActiveRescueByDeviceId() { return { id: 20, device_id: 'RESCUE-001', status: 'SOS' }; },
    async transitionRescue(id, targetStatus) { transitionCalls += 1; return { id, device_id: 'RESCUE-001', status: targetStatus }; }
  };
  const cleared = [];
  const handlers = createActionHandlers({
    io: fakeIo(),
    logger: silentLogger(),
    service,
    updateSosStatus: async () => {},
    clearAction: async (deviceId) => cleared.push(deviceId)
  });

  const action = { action: 'CONFIRM', team_id: 'RESCUE-TEAM-01', timestamp: 123456 };
  // Gia lap Firebase giao cung 1 lan ghi 2 lan (child_added + child_changed).
  await handlers.processAction('RESCUE-001', action);
  await handlers.processAction('RESCUE-001', action);

  assert.equal(transitionCalls, 1);
  assert.deepEqual(cleared, ['RESCUE-001', 'RESCUE-001']);
});

test('a transitionRescue failure is caught and logged, action node is still cleared', async () => {
  await _resetForTest();
  const cleared = [];
  const service = {
    async getActiveRescueByDeviceId() { return { id: 1, device_id: 'RESCUE-001', status: 'SOS' }; },
    async transitionRescue() { throw new Error('DB down'); }
  };
  const handlers = createActionHandlers({
    io: fakeIo(),
    logger: silentLogger(),
    service,
    clearAction: async (deviceId) => cleared.push(deviceId)
  });

  await assert.doesNotReject(handlers.processAction('RESCUE-001', { action: 'CONFIRM' }));
  assert.deepEqual(cleared, ['RESCUE-001']);
});
