const { createClient } = require('redis');

const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 2000;

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    // Keep retrying in the background with a capped delay so the cache
    // recovers automatically after a transient outage. This never blocks
    // startup, since the HTTP server already listens before Redis connects.
    reconnectStrategy: (retries) => Math.min(200 * 2 ** Math.min(retries, 4), 2000),
  },
});

redisClient.on('error', (err) => {
  // Logged, not thrown: the API should stay usable even if the cache is
  // temporarily unreachable, it just falls back to hitting MySQL directly.
  console.error('[redis] connection error:', err.message);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

module.exports = { redisClient, connectRedis };
