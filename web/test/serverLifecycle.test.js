const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { startServer, stopServer } = require('../server/app');

test('server selects the next port when the preferred port is occupied', async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const preferredPort = occupied.address().port;
  const logger = { info() {}, warn() {}, error() {} };
  try {
    const info = await startServer({ preferredPort, host: '127.0.0.1', maxAttempts: 4, logger });
    assert.equal(info.running, true);
    assert.notEqual(info.port, preferredPort);
    assert.equal(info.port, preferredPort + 1);
  } finally {
    await stopServer();
    await new Promise((resolve) => occupied.close(resolve));
  }
});
