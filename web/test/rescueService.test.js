const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGpsPayload, assertTransition } = require('../server/services/rescueService');

test('accepts a valid GPS payload and normalizes fields', () => {
  const result = validateGpsPayload({
    device_id: ' RESCUE-001 ', latitude: 21.5945, longitude: 105.8482,
    battery: 82, rssi: -72, sos: true
  });
  assert.equal(result.deviceId, 'RESCUE-001');
  assert.equal(result.sos, true);
});

test('rejects invalid coordinates and missing device ID', () => {
  assert.throws(() => validateGpsPayload({ latitude: 91, longitude: 10 }), /device_id/);
  assert.throws(() => validateGpsPayload({ device_id: 'A', latitude: -91, longitude: 10 }), /latitude/);
  assert.throws(() => validateGpsPayload({ device_id: 'A', latitude: 10, longitude: 181 }), /longitude/);
});

test('allows only valid rescue state transitions', () => {
  assert.doesNotThrow(() => assertTransition('SOS', 'CONFIRMED'));
  assert.doesNotThrow(() => assertTransition('RESCUING', 'RESCUED'));
  assert.throws(() => assertTransition('RESCUED', 'SOS'), /Khong the chuyen/);
  assert.throws(() => assertTransition('SOS', 'RESCUED'), /Khong the chuyen/);
});
