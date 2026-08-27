const mysql = require('mysql2/promise');

let pool = null;
let activeConfig = null;

function configFromEnv() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gps_rescue'
  };
}

function normalizeConfig(config = configFromEnv()) {
  return {
    host: String(config.host || 'localhost').trim(),
    port: Number(config.port) || 3306,
    user: String(config.user || 'root').trim(),
    password: String(config.password || ''),
    database: String(config.database || 'gps_rescue').trim()
  };
}

function createPool(config) {
  const normalized = normalizeConfig(config);
  activeConfig = normalized;
  return mysql.createPool({
    ...normalized,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    dateStrings: true
  });
}

function getPool() {
  if (!pool) pool = createPool(configFromEnv());
  return pool;
}

async function checkDatabase(config) {
  if (config) return testDatabase(config);
  const connection = await getPool().getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
  return true;
}

async function testDatabase(config) {
  const connection = await mysql.createConnection({
    ...normalizeConfig(config),
    connectTimeout: 5000,
    decimalNumbers: true,
    dateStrings: true
  });
  try {
    await connection.ping();
  } finally {
    await connection.end();
  }
  return true;
}

async function closePool() {
  const current = pool;
  pool = null;
  activeConfig = null;
  if (current) await current.end();
}

async function reconfigureDatabase(config) {
  await closePool();
  const normalized = normalizeConfig(config);
  process.env.DB_HOST = normalized.host;
  process.env.DB_PORT = String(normalized.port);
  process.env.DB_USER = normalized.user;
  process.env.DB_PASSWORD = normalized.password;
  process.env.DB_NAME = normalized.database;
  pool = createPool(normalized);
  return pool;
}

function getDatabaseConfig() {
  const config = activeConfig || normalizeConfig();
  return { host: config.host, port: config.port, user: config.user, database: config.database };
}

module.exports = {
  getPool,
  checkDatabase,
  testDatabase,
  closePool,
  reconfigureDatabase,
  getDatabaseConfig,
  normalizeConfig
};
