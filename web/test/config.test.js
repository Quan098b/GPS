const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readConfig, writeConfig, fromRendererConfig, toRendererConfig } = require('../electron/config');

test('desktop config persists database values without losing special characters', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-rescue-config-'));
  const configPath = path.join(directory, 'config.env');
  const input = {
    dbHost: '192.168.1.20', dbPort: 3307, dbName: 'gps_rescue', dbUser: 'operator',
    dbPassword: 'p@ss # word', apiPort: 3010, gatewayApiKey: 'key with # symbol',
    startWithWindows: true, minimizeToTray: false
  };
  writeConfig(configPath, fromRendererConfig(input));
  const restored = toRendererConfig(readConfig(configPath));
  assert.deepEqual(restored, input);
  fs.rmSync(directory, { recursive: true, force: true });
});
