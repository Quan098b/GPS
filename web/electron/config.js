const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const DEFAULTS = Object.freeze({
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_NAME: 'gps_rescue',
  DB_USER: 'root',
  DB_PASSWORD: '',
  PORT: '3000',
  GATEWAY_API_KEY: 'change_me',
  START_WITH_WINDOWS: 'false',
  MINIMIZE_TO_TRAY: 'true'
});

function resolveConfigPath(app) {
  const developmentPath = path.join(__dirname, '..', '.env');
  if (!app.isPackaged && fs.existsSync(developmentPath)) return developmentPath;
  return path.join(app.getPath('userData'), 'config.env');
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return { ...DEFAULTS };
  const parsed = dotenv.parse(fs.readFileSync(configPath, 'utf8'));
  return { ...DEFAULTS, ...parsed };
}

function applyConfig(config, configPath) {
  for (const [key, value] of Object.entries({ ...DEFAULTS, ...config })) process.env[key] = String(value ?? '');
  process.env.GPS_RESCUE_CONFIG_PATH = configPath;
}

function writeConfig(configPath, config) {
  const normalized = { ...DEFAULTS, ...config };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = Object.keys(DEFAULTS)
    .map((key) => `${key}=${JSON.stringify(String(normalized[key] ?? ''))}`)
    .join('\n');
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
  return normalized;
}

function toDatabaseConfig(config) {
  return {
    host: config.DB_HOST,
    port: Number(config.DB_PORT) || 3306,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD || ''
  };
}

function toRendererConfig(config) {
  return {
    dbHost: config.DB_HOST,
    dbPort: Number(config.DB_PORT) || 3306,
    dbName: config.DB_NAME,
    dbUser: config.DB_USER,
    dbPassword: config.DB_PASSWORD || '',
    apiPort: Number(config.PORT) || 3000,
    gatewayApiKey: config.GATEWAY_API_KEY || '',
    startWithWindows: config.START_WITH_WINDOWS === 'true',
    minimizeToTray: config.MINIMIZE_TO_TRAY !== 'false'
  };
}

function fromRendererConfig(input, current = DEFAULTS) {
  return {
    ...current,
    DB_HOST: String(input.dbHost || 'localhost').trim(),
    DB_PORT: String(Number(input.dbPort) || 3306),
    DB_NAME: String(input.dbName || 'gps_rescue').trim(),
    DB_USER: String(input.dbUser || 'root').trim(),
    DB_PASSWORD: String(input.dbPassword || ''),
    PORT: String(Number(input.apiPort) || 3000),
    GATEWAY_API_KEY: String(input.gatewayApiKey || 'change_me'),
    START_WITH_WINDOWS: input.startWithWindows ? 'true' : 'false',
    MINIMIZE_TO_TRAY: input.minimizeToTray === false ? 'false' : 'true'
  };
}

module.exports = {
  DEFAULTS,
  resolveConfigPath,
  readConfig,
  writeConfig,
  applyConfig,
  toDatabaseConfig,
  toRendererConfig,
  fromRendererConfig
};
