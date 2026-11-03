const express = require('express');
const { checkDbConnection } = require('../config/db');
const { redisClient } = require('../config/redis');

const router = express.Router();

// GET /api/health
// Liveness only: confirms the process is running without calling any
// dependency, so a slow database or cache can never make the process look
// dead to an orchestrator.
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
  });
});

// GET /api/ready
// Readiness: MySQL is a hard dependency, so it must be reachable for the
// instance to receive traffic. Redis is optional and only degrades service.
router.get('/ready', async (req, res) => {
  const health = {
    status: 'ok',
    uptimeSeconds: process.uptime(),
    dependencies: { mysql: 'unknown', redis: 'unknown' },
  };

  let mysqlUp = true;
  try {
    await checkDbConnection();
    health.dependencies.mysql = 'up';
  } catch (err) {
    mysqlUp = false;
    health.dependencies.mysql = 'down';
  }

  const redisReady =
    typeof redisClient.isReady === 'boolean' ? redisClient.isReady : redisClient.isOpen;
  health.dependencies.redis = redisReady ? 'up' : 'down';

  if (!mysqlUp) {
    health.status = 'degraded';
    res.status(503).json(health);
    return;
  }

  if (health.dependencies.redis === 'down') {
    health.status = 'degraded';
  }

  res.status(200).json(health);
});

module.exports = router;
