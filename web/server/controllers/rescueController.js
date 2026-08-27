const rescueService = require('../services/rescueService');

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
      (req.app.get('logger') || console).info?.(`Rescue status changed id=${event.id} status=${event.status}`);
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
