require('dotenv').config();
const createApp = require('./app');
const { connectRedis } = require('./config/redis');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function start() {
  const app = createApp();
  app.listen(PORT, () => {
    logger.info(`FoodFlow API listening on port ${PORT}`);
  });

  try {
    // Redis is an optional performance layer, so connect after the HTTP
    // server is already accepting traffic and never block startup on it.
    await connectRedis();
  } catch (err) {
    logger.error(`could not connect to redis on startup: ${err.message}`);
  }
}

start();
