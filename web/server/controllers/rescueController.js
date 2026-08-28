const rescueService = require('../services/rescueService');
const { removeFirebaseSos, updateFirebaseSosStatus, shouldRemoveFirebaseOnTransition } = require('../services/firebaseSosService');

const FIREBASE_STATUS_BY_TARGET = { CONFIRMED: 'confirmed', RESCUING: 'rescuing' };

function validId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    const error = new Error('Event ID khong hop le');
    error.status = 400;
    throw error;
  }
  return id;
}

async function list(req, res, next) {
  try {
    const data = await rescueService.listRescues(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function detail(req, res, next) {
  try {
    res.json({ success: true, data: await rescueService.getRescue(validId(req.params.id)) });
  } catch (error) {
    next(error);
  }
}

function transition(targetStatus) {
  return async (req, res, next) => {
    try {
      const event = await rescueService.transitionRescue(validId(req.params.id), targetStatus, req.body?.confirmed_by);
      req.app.get('io').emit('rescue:update', event);
      const logger = req.app.get('logger') || console;
      logger.info?.(`Rescue status changed id=${event.id} status=${event.status}`);

      // Dong bo trang thai realtime cho app doi cuu ho (app_cuu_ho doc
      // /sos/{device_id}/status). Loi Firebase khong duoc lam rollback
      // trang thai MySQL da cap nhat thanh cong - chi log warning.
      try {
        const firebaseStatus = FIREBASE_STATUS_BY_TARGET[event.status];
        if (firebaseStatus) {
          const fields = { status: firebaseStatus };
          if (event.status === 'CONFIRMED' && event.confirmed_by) fields.confirmed_by = event.confirmed_by;
          await updateFirebaseSosStatus(event.device_id, fields, logger);
        } else if (shouldRemoveFirebaseOnTransition(event.status)) {
          await removeFirebaseSos(event.device_id, logger);
        }
      } catch (error) {
        logger.warn?.(`Khong the dong bo Firebase SOS cho device=${event.device_id}: ${error.message}`);
      }

      res.json({ success: true, message: 'Cap nhat trang thai thanh cong', data: event });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  list,
  detail,
  confirm: transition('CONFIRMED'),
  start: transition('RESCUING'),
  rescue: transition('RESCUED'),
  cancel: transition('CANCELLED')
};
