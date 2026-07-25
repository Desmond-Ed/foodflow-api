require('dotenv').config();
const createApp = require('./app');
const { connectRedis } = require('./config/redis');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectRedis();
  } catch (err) {
    // The app still boots without Redis; caching is a performance
    // optimization here, not a hard dependency.
    logger.error(`could not connect to redis on startup: ${err.message}`);
  }

  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`FoodFlow API listening on port ${PORT}`);
  });
}

start();
