const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { startServer, stopServer } = require('../server/app');

test('Socket.IO dashboard client receives the server ready event', async () => {
  const logger = { info() {}, warn() {}, error() {} };
  const info = await startServer({ preferredPort: 34000, host: '127.0.0.1', maxAttempts: 20, logger });
  const client = createClient(info.url, { transports: ['websocket'], reconnection: false });
  try {
    const payload = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket.IO connection timed out')), 5000);
      client.once('server:ready', (data) => { clearTimeout(timeout); resolve(data); });
      client.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
    });
    assert.ok(payload.time);
  } finally {
    client.close();
    await stopServer();
  }
});
