const DEFAULT_PENDING_TTL_MINUTES = 30;

function getPendingTtlMs(env = process.env) {
  const configured = Number(env.PAYMENT_PENDING_TTL_MINUTES);
  const minutes =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PENDING_TTL_MINUTES;
  return minutes * 60 * 1000;
}

function isPendingPaymentExpired(payment, now = Date.now(), env = process.env) {
  const createdAt = new Date(payment.created_at).getTime();
  if (!Number.isFinite(createdAt)) {
    return true;
  }
  return now - createdAt >= getPendingTtlMs(env);
}

module.exports = {
  DEFAULT_PENDING_TTL_MINUTES,
  getPendingTtlMs,
  isPendingPaymentExpired,
};
