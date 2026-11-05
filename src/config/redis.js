const { createClient } = require('redis');
const logger = require('../utils/logger');

const DEFAULT_KEY_PREFIX = 'foodflow:';

function decodeCertificate(value) {
  return String(value).replace(/\\n/g, '\n');
}

function isRedisEnabled(env = process.env) {
  return typeof env.REDIS_URL === 'string' && env.REDIS_URL.trim().length > 0;
}

function buildRedisOptions(env = process.env) {
  if (!isRedisEnabled(env)) {
    return null;
  }

  const socket = {
    connectTimeout: Number(env.REDIS_CONNECT_TIMEOUT_MS) || 2000,
    // Keep retrying in the background with a capped delay so the cache
    // recovers automatically after a transient outage. This never blocks
    // startup, since the HTTP server already listens before Redis connects.
    reconnectStrategy: (retries) => Math.min(200 * 2 ** Math.min(retries, 4), 2000),
  };

  if (env.REDIS_TLS_CA) {
    socket.tls = true;
    socket.ca = decodeCertificate(env.REDIS_TLS_CA);
    socket.rejectUnauthorized = true;
  }

  return {
    url: env.REDIS_URL.trim(),
    disableOfflineQueue: true,
    socket,
  };
}

function cacheKey(name, env = process.env) {
  const prefix =
    typeof env.REDIS_KEY_PREFIX === 'string' && env.REDIS_KEY_PREFIX.length > 0
      ? env.REDIS_KEY_PREFIX
      : DEFAULT_KEY_PREFIX;
  return `${prefix}${name}`;
}

const redisClient = isRedisEnabled() ? createClient(buildRedisOptions()) : null;

if (redisClient) {
  redisClient.on('error', (err) => {
    // Logged, not thrown: the API should stay usable even if the cache is
    // temporarily unreachable, it just falls back to hitting MySQL directly.
    logger.error(`[redis] connection error: ${err.message}`);
  });
}

async function connectRedis() {
  if (!redisClient) {
    return false;
  }
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return true;
}

module.exports = {
  redisClient,
  connectRedis,
  buildRedisOptions,
  cacheKey,
  decodeCertificate,
  isRedisEnabled,
};
