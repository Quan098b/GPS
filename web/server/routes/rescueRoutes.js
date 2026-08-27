const express = require('express');
const rescueController = require('../controllers/rescueController');

const router = express.Router();
router.get('/', rescueController.list);
router.get('/:id', rescueController.detail);
router.put('/:id/confirm', rescueController.confirm);
router.put('/:id/start', rescueController.start);
router.put('/:id/rescue', rescueController.rescue);
router.put('/:id/cancel', rescueController.cancel);

module.exports = router;
