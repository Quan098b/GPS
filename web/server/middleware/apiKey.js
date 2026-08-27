function requireGatewayApiKey(req, res, next) {
  const configuredKey = process.env.GATEWAY_API_KEY;
  if (!configuredKey) {
    return res.status(503).json({ success: false, message: 'Gateway API key chua duoc cau hinh' });
  }

  const suppliedKey = req.get('X-API-Key');
  if (!suppliedKey || suppliedKey !== configuredKey) {
    return res.status(401).json({ success: false, message: 'API key khong hop le' });
  }
  return next();
}

module.exports = requireGatewayApiKey;
