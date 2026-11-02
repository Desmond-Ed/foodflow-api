require('./setup');
const request = require('supertest');
const createApp = require('../src/app');
const { checkDbConnection } = require('../src/config/db');
const { redisClient } = require('../src/config/redis');

const app = createApp();

describe('GET /api/health', () => {
  beforeEach(() => {
    checkDbConnection.mockReset();
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  afterEach(() => {
    checkDbConnection.mockReset();
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  it('reports ok when MySQL and Redis are both up', async () => {
    checkDbConnection.mockResolvedValue();
    redisClient.isOpen = true;
    redisClient.isReady = true;

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.mysql).toBe('up');
    expect(res.body.dependencies.redis).toBe('up');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('reports degraded but stays available when Redis is down', async () => {
    checkDbConnection.mockResolvedValue();
    redisClient.isOpen = false;
    redisClient.isReady = false;

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.mysql).toBe('up');
    expect(res.body.dependencies.redis).toBe('down');
  });

  it('reports Redis down while the client reconnects', async () => {
    checkDbConnection.mockResolvedValue();
    redisClient.isOpen = true;
    redisClient.isReady = false;

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.mysql).toBe('up');
    expect(res.body.dependencies.redis).toBe('down');
  });

  it('returns 503 when MySQL is down and reports Redis truthfully', async () => {
    checkDbConnection.mockRejectedValue(new Error('mysql unavailable'));
    redisClient.isOpen = true;
    redisClient.isReady = true;

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.dependencies.mysql).toBe('down');
    expect(res.body.dependencies.redis).toBe('up');
  });
});
