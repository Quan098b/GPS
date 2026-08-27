const express = require('express');
const deviceController = require('../controllers/deviceController');
const requireGatewayApiKey = require('../middleware/apiKey');

const router = express.Router();
router.post('/gps', requireGatewayApiKey, deviceController.receiveGps);
router.get('/devices/summary', deviceController.getSummary);

module.exports = router;
