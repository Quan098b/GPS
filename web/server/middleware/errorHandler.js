function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: 'Khong tim thay endpoint' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'JSON khong hop le' });
  }

  const logger = req.app?.get('logger') || console;
  logger.error?.(`[${new Date().toISOString()}] ${err.stack || err.message}`);
  const databaseUnavailable = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'].includes(err.code);
  const status = err.status || (databaseUnavailable ? 503 : 500);
  const message = status === 500 ? 'Loi may chu noi bo' : err.message;
  return res.status(status).json({ success: false, message });
}

module.exports = { notFoundHandler, errorHandler };
