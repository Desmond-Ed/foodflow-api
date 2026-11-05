require('dotenv').config();
const createApp = require('./app');
const { connectRedis, isRedisEnabled, redisClient } = require('./config/redis');
const { pool } = require('./config/db');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;
const FORCE_EXIT_MS = 10000;

function assertProductionApiKey(env = process.env) {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (!env.API_KEY || env.API_KEY.length < 24) {
    throw new Error('API_KEY must be set to at least 24 characters when NODE_ENV=production');
  }
}

function createShutdownHandler({
  server,
  redisClient,
  pool,
  logger,
  exit = process.exit,
  forceExitMs = FORCE_EXIT_MS,
}) {
  let shuttingDown = false;

  return function shutdown(signal) {
    if (shuttingDown) {
      return Promise.resolve();
    }
    shuttingDown = true;

    logger.info(`${signal} received; shutting down`);

    return new Promise((resolve) => {
      const forceTimer = setTimeout(() => {
        logger.error('graceful shutdown timed out; forcing exit');
        exit(1);
      }, forceExitMs);

      server.close(async (err) => {
        try {
          if (redisClient && redisClient.isReady) {
            await redisClient.quit();
          }
          await pool.end();
          clearTimeout(forceTimer);

          if (err) {
            logger.error(`server close failed: ${err.message}`);
            exit(1);
            resolve();
            return;
          }

          logger.info('shutdown complete');
          exit(0);
          resolve();
        } catch (shutdownErr) {
          clearTimeout(forceTimer);
          logger.error(`shutdown failed: ${shutdownErr.message}`);
          exit(1);
          resolve();
        }
      });
    });
  };
}

async function start() {
  assertProductionApiKey();

  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info(`FoodFlow API listening on port ${PORT}`);
  });

  const shutdown = createShutdownHandler({ server, redisClient, pool, logger });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandled rejection: ${reason instanceof Error ? reason.message : reason}`);
  });

  if (!isRedisEnabled()) {
    logger.info('Redis disabled (REDIS_URL not set)');
    return;
  }

  try {
    // Redis is an optional performance layer, so connect after the HTTP
    // server is already accepting traffic and never block startup on it.
    await connectRedis();
  } catch (err) {
    logger.error(`could not connect to redis on startup: ${err.message}`);
  }
}

if (require.main === module) {
  start().catch((err) => {
    logger.error(`failed to start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { start, createShutdownHandler, assertProductionApiKey };
