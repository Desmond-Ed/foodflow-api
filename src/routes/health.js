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

  let mysqlUp = true;
  try {
    await checkDbConnection();
    health.dependencies.mysql = 'up';
  } catch (err) {
    mysqlUp = false;
    health.dependencies.mysql = 'down';
  }

  health.dependencies.redis = redisClient.isOpen ? 'up' : 'down';

  // MySQL is a hard dependency: without it the service is unavailable.
  // Redis is optional, so a missing cache only degrades the service.
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
