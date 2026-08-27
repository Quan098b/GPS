const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const projectRoot = path.join(__dirname, '..', '..');
const DEFAULT_DATABASE_URL = 'https://gpshelp-22dc8-default-rtdb.asia-southeast1.firebasedatabase.app';
const DEFAULT_CREDENTIAL_FILENAME = 'SDK.json';
const SKIP_FILES = new Set(['package.json', 'package-lock.json']);

let firebaseApp = null;
let initAttempted = false;
let initWarning = null;

function isServiceAccountJson(content) {
  return Boolean(
    content
    && content.type === 'service_account'
    && typeof content.project_id === 'string'
    && typeof content.private_key === 'string'
    && typeof content.client_email === 'string'
  );
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function findServiceAccountInDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json') || SKIP_FILES.has(entry)) continue;
    const filePath = path.join(dir, entry);
    const content = readJsonFile(filePath);
    if (isServiceAccountJson(content)) return { filePath, content };
  }
  return null;
}

// Ung dung dong goi (Electron production) khong nen dong goi private key vao
// installer: credential doc tu thu muc userData ben ngoai EXE.
function loadFromElectronUserData() {
  if (!process.versions.electron) return null;
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron');
    if (!app || !app.isPackaged) return null;
    const userDataFile = path.join(app.getPath('userData'), 'firebase-admin.json');
    const content = readJsonFile(userDataFile);
    if (isServiceAccountJson(content)) return { filePath: userDataFile, content };
  } catch {
    return null;
  }
  return null;
}

function resolveServiceAccount() {
  const envValue = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envValue) {
    const trimmed = envValue.trim();
    if (trimmed.startsWith('{')) {
      const content = (() => { try { return JSON.parse(trimmed); } catch { return null; } })();
      if (isServiceAccountJson(content)) return { filePath: '(FIREBASE_SERVICE_ACCOUNT inline JSON)', content };
    } else {
      const resolvedPath = path.resolve(trimmed);
      const content = readJsonFile(resolvedPath);
      if (isServiceAccountJson(content)) return { filePath: resolvedPath, content };
    }
  }

  const fromUserData = loadFromElectronUserData();
  if (fromUserData) return fromUserData;

  const defaultFile = path.resolve(projectRoot, DEFAULT_CREDENTIAL_FILENAME);
  const defaultContent = readJsonFile(defaultFile);
  if (isServiceAccountJson(defaultContent)) return { filePath: defaultFile, content: defaultContent };

  return findServiceAccountInDir(projectRoot);
}

// Khoi tao Firebase Admin dung mot lan. Goi lai nhieu lan (vi du Electron
// restart server noi bo) se tra ve app da khoi tao truoc do, khong tao lai.
function getFirebaseApp(logger = console) {
  if (firebaseApp || initAttempted) return firebaseApp;
  initAttempted = true;

  const found = resolveServiceAccount();
  if (!found) {
    initWarning = 'Khong tim thay Firebase Admin credential (FIREBASE_SERVICE_ACCOUNT hoac file JSON service account trong thu muc web). Firebase SOS listener bi vo hieu hoa.';
    logger.warn?.(`[Firebase] ${initWarning}`);
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.cert(found.content),
      databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL
    });
    logger.info?.(`[Firebase] Da khoi tao Admin SDK tu ${found.filePath}`);
    return firebaseApp;
  } catch (error) {
    initWarning = `Khoi tao Firebase Admin that bai: ${error.message}`;
    logger.warn?.(`[Firebase] ${initWarning}`);
    firebaseApp = null;
    return null;
  }
}

function getFirebaseWarning() {
  return initWarning;
}

// Dong hoan toan Firebase Admin app (huy ket noi RTDB va timer refresh
// token noi bo). Can thiet khi tat server/Electron de tien trinh Node
// thoat sach, khong treo vi socket/timer con mo. Sau khi goi, lan
// getFirebaseApp() tiep theo se doc lai credential va khoi tao moi.
async function closeFirebaseApp(logger = console) {
  const app = firebaseApp;
  firebaseApp = null;
  initAttempted = false;
  initWarning = null;
  if (!app) return;
  try {
    await app.delete();
  } catch (error) {
    logger.warn?.(`[Firebase] Loi khi dong Firebase Admin app: ${error.message}`);
  }
}

// Chi danh cho test: dua module ve trang thai chua khoi tao.
function _resetForTest() {
  firebaseApp = null;
  initAttempted = false;
  initWarning = null;
}

module.exports = {
  getFirebaseApp,
  getFirebaseWarning,
  closeFirebaseApp,
  isServiceAccountJson,
  DEFAULT_DATABASE_URL,
  _resetForTest
};
