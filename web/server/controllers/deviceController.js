const rescueService = require('../services/rescueService');

async function receiveGps(req, res, next) {
  try {
    const result = await rescueService.ingestGps(req.body);
    const io = req.app.get('io');
    const logger = req.app.get('logger') || console;
    const update = {
      device_id: result.data.deviceId,
      latitude: result.data.latitude,
      longitude: result.data.longitude,
      accuracy: result.data.accuracy,
      battery: result.data.battery,
      rssi: result.data.rssi,
      event_id: result.event?.id || null,
      status: result.event?.status || null,
      created_at: new Date().toISOString()
    };
    io.emit('gps:update', update);
    if (result.event) io.emit(result.isNewEvent ? 'rescue:new' : 'rescue:update', result.event);
    if (result.event) logger.info?.(`${result.isNewEvent ? 'New rescue event' : 'Rescue location updated'} id=${result.event.id} device=${result.data.deviceId}`);

    res.status(result.isNewEvent ? 201 : 200).json({
      success: true,
      message: 'Location received',
      event_id: result.event?.id || null
    });
  } catch (error) {
    next(error);
  }
}

async function getSummary(req, res, next) {
  try {
    res.json({ success: true, data: await rescueService.getDeviceSummary() });
  } catch (error) {
    next(error);
  }
}

module.exports = { receiveGps, getSummary };
