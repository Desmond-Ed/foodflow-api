const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
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
