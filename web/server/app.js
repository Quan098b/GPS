const path = require('path');
const os = require('os');
const http = require('http');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: process.env.GPS_RESCUE_CONFIG_PATH || path.join(projectRoot, '.env') });

const { checkDatabase, closePool } = require('./config/database');
const deviceRoutes = require('./routes/deviceRoutes');
const rescueRoutes = require('./routes/rescueRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

let runtime = null;

function getLanIpv4() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal || address.address.startsWith('169.254.')) continue;
      const virtual = /virtual|vmware|vbox|hyper-v|loopback|docker|wsl|bluetooth/i.test(name);
      candidates.push({ address: address.address, virtual });
    }
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual));
  return candidates[0]?.address || '127.0.0.1';
}

function createRuntime(logger = console) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  const state = { port: null, host: null, startedAt: null, logger };

  app.set('io', io);
  app.set('serverState', state);
  app.set('logger', logger);
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.use('/vendor/bootstrap', express.static(path.join(projectRoot, 'node_modules', 'bootstrap', 'dist')));
  app.use('/vendor/bootstrap-icons', express.static(path.join(projectRoot, 'node_modules', 'bootstrap-icons')));
  app.use('/vendor/leaflet', express.static(path.join(projectRoot, 'node_modules', 'leaflet', 'dist')));
  app.use(express.static(path.join(projectRoot, 'public')));

  app.get('/api/health', async (req, res) => {
    try {
      await checkDatabase();
      res.json({ success: true, server: 'online', database: 'online', port: state.port, time: new Date().toISOString() });
    } catch (error) {
      res.status(503).json({ success: false, server: 'online', database: 'offline', port: state.port, message: 'Khong the ket noi MySQL' });
    }
  });

  app.get('/api/system/info', async (req, res) => {
    let database = 'offline';
    try { await checkDatabase(); database = 'online'; } catch { /* Offline is a supported application mode. */ }
    const lanAddress = getLanIpv4();
    res.json({
      success: true,
      data: {
        server: 'online',
        database,
        port: state.port,
        lan_ip: lanAddress,
        gateway_api: `http://${lanAddress}:${state.port}/api/gps`,
        started_at: state.startedAt
      }
    });
  });

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.method === 'POST' && req.path === '/api/gps') {
        logger.info?.(`GPS API ${res.statusCode} ${Date.now() - started}ms device=${req.body?.device_id || 'unknown'}`);
      }
    });
    next();
  });
  app.use('/api', deviceRoutes);
  app.use('/api/rescues', rescueRoutes);
  app.use('/api', notFoundHandler);
  app.get('*', (req, res) => res.sendFile(path.join(projectRoot, 'public', 'index.html')));
  app.use(errorHandler);

  io.on('connection', (socket) => socket.emit('server:ready', { time: new Date().toISOString() }));
  return { app, server, io, state };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startServer(options = {}) {
  if (runtime?.server.listening) return getServerInfo();
  const preferredPort = Number(options.preferredPort ?? process.env.PORT) || 3000;
  const host = options.host || '0.0.0.0';
  const maxAttempts = Number(options.maxAttempts) || 20;
  runtime = createRuntime(options.logger || console);

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset;
    try {
      await listen(runtime.server, port, host);
      runtime.state.port = port;
      runtime.state.host = host;
      runtime.state.startedAt = new Date().toISOString();
      runtime.state.logger.info?.(`Express server started on ${host}:${port}`);
      return getServerInfo();
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || offset === maxAttempts - 1) {
        runtime = null;
        throw error;
      }
      runtime.state.logger.warn?.(`Port ${port} is busy, trying ${port + 1}`);
    }
  }
  throw new Error('Khong tim thay cong mang kha dung');
}

async function stopServer(options = {}) {
  const current = runtime;
  runtime = null;
  if (current) {
    await new Promise((resolve) => current.io.close(() => resolve()));
    if (current.server.listening) await new Promise((resolve) => current.server.close(() => resolve()));
    current.state.logger.info?.('Express and Socket.IO stopped');
  }
  if (options.closeDatabase !== false) await closePool();
}

async function restartServer(options = {}) {
  await stopServer();
  return startServer(options);
}

function getServerInfo() {
  if (!runtime?.server.listening) return { running: false, port: null, host: null, lanIp: getLanIpv4() };
  const lanIp = getLanIpv4();
  return {
    running: true,
    port: runtime.state.port,
    host: runtime.state.host,
    lanIp,
    url: `http://127.0.0.1:${runtime.state.port}`,
    gatewayApi: `http://${lanIp}:${runtime.state.port}/api/gps`
  };
}

if (require.main === module) {
  startServer()
    .then((info) => {
      console.log(`GPS Rescue server running at ${info.url}`);
      return checkDatabase();
    })
    .then(() => console.log('MySQL connected'))
    .catch((error) => {
      if (getServerInfo().running) console.warn(`MySQL unavailable: ${error.message}`);
      else { console.error(error); process.exitCode = 1; }
    });

  const shutdown = async () => { await stopServer(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { startServer, stopServer, restartServer, getServerInfo, getLanIpv4 };
