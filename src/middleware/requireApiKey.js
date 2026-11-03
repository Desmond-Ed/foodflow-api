const crypto = require('crypto');
const { ApiError } = require('./errorHandler');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireApiKey(req, res, next) {
  const configuredKey = process.env.API_KEY;
  const providedKey = req.get('x-api-key');

  if (!configuredKey || !providedKey || !safeEqual(providedKey, configuredKey)) {
    next(new ApiError(401, 'Invalid API key'));
    return;
  }

  next();
}

module.exports = { requireApiKey, safeEqual };
