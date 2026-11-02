require('./setup');

process.env.NOMINATIM_MIN_INTERVAL_MS = '0';

const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');
const { redisClient } = require('../src/config/redis');

const app = createApp();

describe('POST /api/addresses/resolve', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    redisClient.isOpen = false;
    redisClient.isReady = false;
  });

  it('resolves an address via Nominatim on a full cache miss', async () => {
    pool.query
      .mockResolvedValueOnce([[]]) // MySQL cache miss
      .mockResolvedValueOnce([{}]); // INSERT ... ON DUPLICATE KEY UPDATE
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '6.6018', lon: '3.3515' }],
    });

    const res = await request(app)
      .post('/api/addresses/resolve')
      .send({ rawAddress: 'Some New Unseen Street, Lagos' });

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('nominatim');
    expect(typeof res.body.data.latitude).toBe('number');
    expect(typeof res.body.data.longitude).toBe('number');
    expect(res.body.data.confidence).toBe('high');
  });

  it.each([
    ['missing', {}],
    ['empty', { rawAddress: '' }],
    ['non-string', { rawAddress: 123 }],
  ])('rejects a %s rawAddress with a 400', async (label, body) => {
    const res = await request(app).post('/api/addresses/resolve').send(body);

    expect(res.status).toBe(400);
  });

  it('returns 422 when the address cannot be resolved', async () => {
    pool.query.mockResolvedValueOnce([[]]); // MySQL cache miss
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const res = await request(app)
      .post('/api/addresses/resolve')
      .send({ rawAddress: 'Completely made up nonexistent place' });

    expect(res.status).toBe(422);
  });
});
