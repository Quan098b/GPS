const { getDatabase } = require('firebase-admin/database');
const rescueService = require('./rescueService');
const { getFirebaseApp } = require('../config/firebase');
const { removeFirebaseSos, updateFirebaseSosStatus, shouldRemoveFirebaseOnTransition } = require('./firebaseSosService');

const ACTIONS_PATH = 'rescue_actions';
const DEFAULT_TEAM_ID = 'RESCUE-TEAM-01';

// Firebase status hien thi cho app doi cuu ho, ghi sau khi backend xu ly
// action thanh cong. "waiting" la trang thai ban dau ESP tu ghi, khong can
// map o day.
const ACTION_TO_TARGET_STATUS = {
  CONFIRM: 'CONFIRMED',
  START_RESCUE: 'RESCUING',
  RESCUED: 'RESCUED',
  FAILED: 'CANCELLED',
  CANCEL: 'CANCELLED'
};

const TARGET_STATUS_TO_FIREBASE_STATUS = {
  CONFIRMED: 'confirmed',
  RESCUING: 'rescuing'
  // RESCUED/CANCELLED khong can map o day - node bi xoa ngay sau khi hien
  // trang thai cuoi mot khoang ngan (xem CLEANUP_DELAY_MS ben duoi).
};

// Cho app doi cuu ho hien trang thai cuoi cung (rescued/failed) mot chut
// truoc khi node /sos/{deviceId} bien mat, thay vi xoa ngay lap tuc.
const CLEANUP_DELAY_MS = 3000;

let currentListener = null;

// device_id -> { action, processedAt }. Firebase Realtime Database giao
// CUNG 1 lan ghi dung ServerValue.TIMESTAMP thanh 2 su kien lien tiep tren
// cung 1 ket noi: 1 lan voi gia tri uoc luong cuc bo, 1 lan voi gia tri
// server chinh thuc (2 timestamp nay KHAC NHAU nen khong the dung timestamp
// lam khoa dedupe truc tiep). Thay vao do, chan cung 1 loai action cho
// cung thiet bi neu no vua duoc xu ly trong 1 cua so ngan.
const processedActions = new Map();
const DEDUPE_WINDOW_MS = 5000;

function isDuplicateAction(deviceId, action) {
  const last = processedActions.get(deviceId);
  if (!last || last.action !== action) return false;
  return Date.now() - last.processedAt < DEDUPE_WINDOW_MS;
}

function markActionProcessed(deviceId, action) {
  processedActions.set(deviceId, { action, processedAt: Date.now() });
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = typeof raw.action === 'string' ? raw.action.trim().toUpperCase() : '';
  if (!ACTION_TO_TARGET_STATUS[action]) return null;
  return {
    action,
    teamId: typeof raw.team_id === 'string' && raw.team_id.trim() ? raw.team_id.trim() : DEFAULT_TEAM_ID,
    reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 500) : null,
    timestamp: raw.timestamp ?? null
  };
}

// Tao 1 bo xu ly action, tach khoi firebase-admin de co the unit test bang
// du lieu gia (giong pattern cua firebaseSosService.createSosHandlers).
function createActionHandlers({
  io,
  logger = console,
  service = rescueService,
  removeSos = removeFirebaseSos,
  updateSosStatus = updateFirebaseSosStatus,
  clearAction = async () => {}
} = {}) {
  async function processAction(deviceId, rawAction) {
    const action = normalizeAction(rawAction);
    if (!action) {
      logger.warn?.(`[RescueActions] Action khong hop le device=${deviceId}: ${JSON.stringify(rawAction)}`);
      await clearAction(deviceId);
      return;
    }

    // Chan xu ly trung: Firebase co the giao cung 1 lan ghi qua ca
    // 'child_added' lan 'child_changed' (SDK dong bo gia tri optimistic voi
    // gia tri server tra ve cho ServerValue.TIMESTAMP). Neu vua xu ly dung
    // loai action nay cho thiet bi nay trong cua so ngan thi bo qua.
    if (isDuplicateAction(deviceId, action.action)) {
      logger.warn?.(`[RescueActions] Bo qua action trung lap device=${deviceId} action=${action.action}`);
      await clearAction(deviceId);
      return;
    }
    markActionProcessed(deviceId, action.action);

    try {
      const event = await service.getActiveRescueByDeviceId(deviceId);
      if (!event) {
        logger.warn?.(`[RescueActions] Khong tim thay rescue_event dang hoat dong cho device=${deviceId}, bo qua action ${action.action}`);
        return;
      }

      const targetStatus = ACTION_TO_TARGET_STATUS[action.action];
      const confirmedBy = targetStatus === 'CONFIRMED' ? action.teamId : undefined;
      const updated = await service.transitionRescue(event.id, targetStatus, confirmedBy);

      if (io) io.emit('rescue:update', updated);
      logger.info?.(`[RescueActions] ${action.action} device=${deviceId} eventId=${event.id} -> ${targetStatus}`);

      const firebaseStatus = TARGET_STATUS_TO_FIREBASE_STATUS[targetStatus];
      if (firebaseStatus) {
        const fields = { status: firebaseStatus };
        if (targetStatus === 'CONFIRMED') fields.confirmed_by = action.teamId;
        await updateSosStatus(deviceId, fields, logger);
      }

      if (shouldRemoveFirebaseOnTransition(targetStatus)) {
        const finalStatus = action.action === 'FAILED' ? 'failed' : (action.action === 'CANCEL' ? 'cancelled' : 'rescued');
        const finalFields = { status: finalStatus };
        if (action.reason) finalFields.reason = action.reason;
        await updateSosStatus(deviceId, finalFields, logger);
        setTimeout(() => {
          removeSos(deviceId, logger).catch((error) => logger.warn?.(`[RescueActions] Cleanup Firebase loi device=${deviceId}: ${error.message}`));
        }, CLEANUP_DELAY_MS);
      }
    } catch (error) {
      logger.error?.(`[RescueActions] Xu ly action ${action.action} device=${deviceId} that bai: ${error.message}`);
    } finally {
      // Luon xoa action node de tranh xu ly lai (dong bo hay bat dong bo loi
      // deu khong duoc de action "song" mai o Firebase).
      await clearAction(deviceId);
    }
  }

  return { processAction };
}

// Bat dau lang nghe /rescue_actions/{deviceId} tu app doi cuu ho. Dung ca
// child_added va child_changed vi app luon ghi vao 1 key co dinh theo
// device_id (khong dung push key) - neu action truoc do chua kip xoa xong
// va action moi den, Firebase co the bao child_changed thay vi child_added.
async function startRescueActionsListener({ io, logger = console, service = rescueService } = {}) {
  if (currentListener) {
    await currentListener.stop();
    currentListener = null;
  }

  const app = getFirebaseApp(logger);
  if (!app) {
    logger.warn?.('[RescueActions] Firebase chua duoc cau hinh, listener rescue_actions bi vo hieu hoa.');
    return { async stop() {} };
  }

  const database = getDatabase(app);
  database.goOnline();
  const ref = database.ref(ACTIONS_PATH);

  const clearAction = async (deviceId) => {
    try {
      await ref.child(deviceId).remove();
    } catch (error) {
      logger.warn?.(`[RescueActions] Khong the xoa /rescue_actions/${deviceId}: ${error.message}`);
    }
  };

  const handlers = createActionHandlers({ io, logger, service, clearAction });

  const onAdded = (snapshot) => { handlers.processAction(snapshot.key, snapshot.val()); };
  const onChanged = (snapshot) => { handlers.processAction(snapshot.key, snapshot.val()); };

  ref.on('child_added', onAdded, (error) => logger.error?.(`[RescueActions] child_added loi: ${error.message}`));
  ref.on('child_changed', onChanged, (error) => logger.error?.(`[RescueActions] child_changed loi: ${error.message}`));

  logger.info?.(`[RescueActions] Dang lang nghe realtime tai /${ACTIONS_PATH}`);

  currentListener = {
    async stop() {
      ref.off('child_added', onAdded);
      ref.off('child_changed', onChanged);
      logger.info?.('[RescueActions] Da dung listener realtime /rescue_actions');
    }
  };
  return currentListener;
}

async function stopRescueActionsListener() {
  if (currentListener) {
    const listener = currentListener;
    currentListener = null;
    await listener.stop();
  }
}

async function _resetForTest() {
  processedActions.clear();
  await stopRescueActionsListener();
}

module.exports = {
  normalizeAction,
  createActionHandlers,
  startRescueActionsListener,
  stopRescueActionsListener,
  ACTION_TO_TARGET_STATUS,
  DEFAULT_TEAM_ID,
  _resetForTest
};
