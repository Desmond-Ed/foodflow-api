const express = require('express');
const { checkDbConnection } = require('../config/db');
const { redisClient } = require('../config/redis');

const router = express.Router();

// GET /api/health
// A lightweight endpoint an uptime monitor (or load balancer) can poll
// to confirm the API and its dependencies are actually reachable, not
// just that the Node process is running.
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    uptimeSeconds: process.uptime(),
    dependencies: { mysql: 'unknown', redis: 'unknown' },
  };

  try {
    await checkDbConnection();
    health.dependencies.mysql = 'up';
  } catch (err) {
    health.dependencies.mysql = 'down';
    health.status = 'degraded';
  }

  health.dependencies.redis = redisClient.isOpen ? 'up' : 'down';
  if (!redisClient.isOpen) health.status = 'degraded';

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

module.exports = router;
