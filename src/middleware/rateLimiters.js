const rateLimit = require('express-rate-limit');

function positiveIntegerFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const GENERAL_LIMIT_MAX = positiveIntegerFromEnv('RATE_LIMIT_MAX', 100);
const WEBHOOK_LIMIT_MAX = positiveIntegerFromEnv('WEBHOOK_RATE_LIMIT_MAX', 1000);

function isWebhookRequest(req) {
  const originalUrl = req.originalUrl || req.url || '';
  const pathname = originalUrl.split('?')[0].split('#')[0];
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalized === '/api/payments/webhook';
}

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: GENERAL_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWebhookRequest,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: WEBHOOK_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { isWebhookRequest, generalLimiter, webhookLimiter };
