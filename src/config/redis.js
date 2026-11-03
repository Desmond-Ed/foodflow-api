const { createClient } = require('redis');
const logger = require('../utils/logger');

function decodeCertificate(value) {
  return String(value).replace(/\\n/g, '\n');
}

function buildRedisOptions(env = process.env) {
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
    url: env.REDIS_URL || 'redis://localhost:6379',
    disableOfflineQueue: true,
    socket,
  };
}

const redisClient = createClient(buildRedisOptions());

redisClient.on('error', (err) => {
  // Logged, not thrown: the API should stay usable even if the cache is
  // temporarily unreachable, it just falls back to hitting MySQL directly.
  logger.error(`[redis] connection error: ${err.message}`);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

module.exports = {
  redisClient,
  connectRedis,
  buildRedisOptions,
  decodeCertificate,
};
