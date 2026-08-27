const path = require('path');
const { execFile } = require('child_process');
const {
  app, BrowserWindow, Menu, Tray, dialog, ipcMain, clipboard, shell, session, nativeImage
} = require('electron');
const log = require('electron-log/main');
const {
  resolveConfigPath, readConfig, writeConfig, applyConfig,
  toDatabaseConfig, toRendererConfig, fromRendererConfig
} = require('./config');

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

let mainWindow = null;
let splashWindow = null;
let setupWindow = null;
let tray = null;
let configPath = null;
let config = null;
let serverApi = null;
let databaseApi = null;
let serverInfo = null;
let isQuitting = false;
let shutdownComplete = false;
let launchInProgress = false;
let setupCompleted = false;

function booleanValue(value) { return value === true || value === 'true'; }
function preloadPath() { return path.join(__dirname, 'preload.js'); }

function configureLogging() {
  log.initialize();
  log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'application.log');
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.info(`Application start version=${app.getVersion()} packaged=${app.isPackaged}`);
}

function sendSplash(text, step) {
  log.info(`Startup: ${text}`);
  splashWindow?.webContents.send('splash:status', { text, step });
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 540, height: 330, resizable: false, frame: false, show: false,
    backgroundColor: '#0b1118', autoHideMenuBar: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  splashWindow.loadFile(path.join(__dirname, 'ui', 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
}

function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    width: 720, height: 760, minWidth: 640, minHeight: 680, show: false,
    backgroundColor: '#0b1118', autoHideMenuBar: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  setupWindow.loadFile(path.join(__dirname, 'ui', 'setup.html'));
  setupWindow.once('ready-to-show', () => { splashWindow?.hide(); setupWindow?.show(); });
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!setupCompleted && !serverInfo && !isQuitting) shutdownAndQuit();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 950, minWidth: 1100, minHeight: 700,
    autoHideMenuBar: true, backgroundColor: '#080d13', show: false,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch((error) => log.error(error));
    return { action: 'deny' };
  });
  mainWindow.webContents.on('preload-error', (_event, preload, error) => log.error(`Preload error ${preload}: ${error.stack || error.message}`));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => log.error(`Renderer load failed ${code} ${description} ${url}`));
  mainWindow.webContents.on('render-process-gone', (_event, details) => log.error(`Renderer process gone: ${JSON.stringify(details)}`));
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      log.warn(`Renderer console: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  mainWindow.on('close', async (event) => {
    if (isQuitting) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'LoRa GPS Rescue',
      message: 'Bạn muốn ẩn hệ thống hay thoát hoàn toàn?',
      detail: 'Khi ẩn xuống khay hệ thống, API LoRa và việc ghi dữ liệu vẫn tiếp tục hoạt động.',
      buttons: ['Ẩn xuống khay hệ thống', 'Thoát hoàn toàn', 'Hủy'],
      defaultId: config?.MINIMIZE_TO_TRAY === 'false' ? 1 : 0, cancelId: 2, noLink: true
    });
    if (result.response === 0) mainWindow?.hide();
    if (result.response === 1) shutdownAndQuit();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function createTray() {
  if (tray) return;
  try {
    const markerPath = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'images', 'marker-icon.png');
    const trayImage = nativeImage.createFromPath(markerPath).resize({ width: 16, height: 24 });
    tray = new Tray(trayImage);
    tray.setToolTip('LoRa GPS Rescue');
    tray.on('double-click', showMainWindow);
    rebuildTrayMenu();
  } catch (error) {
    log.warn(`Cannot create system tray: ${error.message}`);
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const status = serverInfo?.running ? `Server online - cổng ${serverInfo.port}` : 'Server offline';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở hệ thống cứu hộ', click: showMainWindow },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Khởi động lại server', click: () => restartBackend().catch(showFatalError) },
    { label: 'Thoát', click: shutdownAndQuit }
  ]));
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function loadBackendModules() {
  if (!serverApi) serverApi = require('../server/app');
  if (!databaseApi) databaseApi = require('../server/config/database');
}

async function getMysqlServiceState() {
  if (process.platform !== 'win32') return { available: false, state: 'unsupported' };
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', 'MySQL80'], { windowsHide: true }, (error, stdout = '') => {
      if (error) return resolve({ available: false, state: 'not-found', message: error.message });
      const match = stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
      resolve({ available: true, state: (match?.[1] || 'unknown').toLowerCase() });
    });
  });
}

async function startMysqlService() {
  if (process.platform !== 'win32') throw new Error('Chức năng này chỉ hỗ trợ Windows.');
  return new Promise((resolve, reject) => {
    execFile('sc.exe', ['start', 'MySQL80'], { windowsHide: true }, (error, stdout = '', stderr = '') => {
      if (error) return reject(new Error(`Không thể khởi động MySQL80. Hãy thử chạy phần mềm với quyền phù hợp hoặc mở Services. ${stderr || error.message}`));
      resolve({ success: true, message: stdout.trim() || 'Đã gửi yêu cầu khởi động MySQL80.' });
    });
  });
}

async function confirmOfflineMode() {
  const service = await getMysqlServiceState();
  const detail = [
    `Dịch vụ MySQL80: ${service.state}`,
    '', 'Vui lòng kiểm tra:', '- MySQL80 đang chạy', '- DB_HOST và DB_PORT',
    '- DB_USER và DB_PASSWORD', '- DB_NAME'
  ].join('\n');
  while (true) {
    const result = await dialog.showMessageBox({
      type: 'warning', title: 'Không thể kết nối MySQL', message: 'Không thể kết nối MySQL', detail,
      buttons: ['Thử lại', 'Mở phần mềm ở chế độ offline', 'Thoát'], defaultId: 0, cancelId: 2, noLink: true
    });
    if (result.response === 1) return true;
    if (result.response === 2) return false;
    sendSplash('Đang kết nối lại MySQL', 2);
    try { await databaseApi.checkDatabase(); return true; } catch (error) { log.warn(`MySQL retry failed: ${error.code || error.message}`); }
  }
}

async function startBackend() {
  loadBackendModules();
  sendSplash('Đang khởi động server', 1);
  serverInfo = await serverApi.startServer({ preferredPort: Number(config.PORT) || 3000, host: '0.0.0.0', logger: log });
  rebuildTrayMenu();
  sendSplash('Đang kết nối MySQL', 2);
  try {
    await databaseApi.checkDatabase();
    log.info('MySQL connected');
  } catch (error) {
    log.warn(`MySQL unavailable: ${error.code || error.message}`);
    const proceed = await confirmOfflineMode();
    if (!proceed) { await shutdownAndQuit(); return false; }
  }
  return true;
}

async function launchDashboard() {
  sendSplash('Đang tải bản đồ', 3);
  const win = mainWindow || createMainWindow();
  await win.loadURL(serverInfo.url);
  createTray();
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      splashWindow?.close();
      win.show();
    }
  }, 2500);
}

async function launchApplication() {
  if (launchInProgress) return;
  launchInProgress = true;
  try {
    if (!splashWindow) createSplash();
    const started = await startBackend();
    if (started) await launchDashboard();
  } finally {
    launchInProgress = false;
  }
}

async function restartBackend() {
  loadBackendModules();
  log.info('Restarting backend by user request');
  applyConfig(config, configPath);
  await databaseApi.reconfigureDatabase(toDatabaseConfig(config));
  serverInfo = await serverApi.restartServer({ preferredPort: Number(config.PORT) || 3000, host: '0.0.0.0', logger: log });
  rebuildTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(serverInfo.url);
  return serverInfo;
}

async function shutdownAndQuit() {
  if (isQuitting) return;
  isQuitting = true;
  log.info('Full application shutdown requested');
  try {
    if (serverApi) await serverApi.stopServer();
  } catch (error) {
    log.error(`Shutdown error: ${error.stack || error.message}`);
  }
  shutdownComplete = true;
  tray?.destroy();
  tray = null;
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.quit();
}

function showFatalError(error) {
  log.error(error?.stack || error);
  if (app.isReady()) dialog.showErrorBox('Lỗi hệ thống', 'Ứng dụng gặp lỗi nghiêm trọng. Chi tiết đã được ghi vào application.log.');
}

function registerIpc() {
  ipcMain.handle('config:get', () => toRendererConfig(config));
  ipcMain.handle('config:test-database', async (_event, input) => {
    loadBackendModules();
    try { await databaseApi.testDatabase(toDatabaseConfig(fromRendererConfig(input, config))); return { success: true, message: 'KẾT NỐI MYSQL THÀNH CÔNG' }; }
    catch (error) { log.warn(`Database test failed: ${error.code || error.message}`); return { success: false, message: error.message, code: error.code }; }
  });
  ipcMain.handle('config:save', async (_event, input) => {
    config = writeConfig(configPath, fromRendererConfig(input, config));
    applyConfig(config, configPath);
    app.setLoginItemSettings({ openAtLogin: booleanValue(config.START_WITH_WINDOWS), path: process.execPath });
    log.info('Configuration saved');
    return { success: true, config: toRendererConfig(config) };
  });
  ipcMain.handle('setup:complete', async () => {
    setupCompleted = true;
    setupWindow?.close();
    splashWindow?.show();
    await launchApplication();
    return { success: true };
  });
  ipcMain.handle('server:restart', () => restartBackend());
  ipcMain.handle('system:get-info', async () => ({ ...serverInfo, mysqlService: await getMysqlServiceState(), configPath }));
  ipcMain.handle('mysql:start-service', () => startMysqlService());
  ipcMain.handle('application:set-login-item', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
    return app.getLoginItemSettings();
  });
  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('external:open', (_event, url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Chỉ cho phép mở liên kết HTTPS.');
    return shell.openExternal(url);
  });
  ipcMain.on('dashboard:ready', () => {
    sendSplash('Sẵn sàng', 4);
    setTimeout(() => { splashWindow?.close(); splashWindow = null; showMainWindow(); }, 250);
  });
  ipcMain.on('renderer:realtime', (_event, data) => {
    log.info(`Renderer realtime id=${Number(data?.eventId) || 0} markers=${Number(data?.markerCount) || 0}`);
  });
}

process.on('uncaughtException', (error) => showFatalError(error));
process.on('unhandledRejection', (error) => showFatalError(error));

if (singleInstance) app.on('second-instance', showMainWindow);
app.on('before-quit', (event) => {
  if (!shutdownComplete) { event.preventDefault(); shutdownAndQuit(); }
});
app.on('window-all-closed', () => { /* Tray mode keeps the backend alive. */ });

if (singleInstance) app.whenReady().then(async () => {
  configureLogging();
  registerIpc();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const localDashboard = webContents.getURL().startsWith('http://127.0.0.1:');
    callback(permission === 'geolocation' && localDashboard);
  });
  configPath = resolveConfigPath(app);
  const hasConfig = require('fs').existsSync(configPath);
  config = readConfig(configPath);
  applyConfig(config, configPath);
  app.setLoginItemSettings({ openAtLogin: booleanValue(config.START_WITH_WINDOWS), path: process.execPath });
  createSplash();
  if (!hasConfig) createSetupWindow();
  else await launchApplication();
}).catch(showFatalError);
