require('./setup');

jest.mock('../src/services/geocodingService', () => ({
  resolveAddress: jest.fn(),
}));

const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');
const { resolveAddress } = require('../src/services/geocodingService');
const { haversineDistanceKm } = require('../src/services/deliveryFeeService');

const app = createApp();

const vendor = { id: 1, name: 'Test Vendor', latitude: 6.6018, longitude: 3.3515 };

describe('POST /api/delivery/quote', () => {
  beforeEach(() => {
    pool.query.mockReset();
    resolveAddress.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a distance and fee for a nearby resolvable address', async () => {
    pool.query.mockResolvedValueOnce([[vendor]]);
    resolveAddress.mockResolvedValueOnce({
      normalizedAddress: 'Somewhere, Lagos, Nigeria',
      latitude: 6.6018,
      longitude: 3.36,
      confidence: 'high',
      source: 'nominatim',
    });

    const res = await request(app)
      .post('/api/delivery/quote').set('x-api-key', process.env.API_KEY)
      .send({ vendorId: 1, customerAddress: 'Somewhere' });

    const distance = haversineDistanceKm(6.6018, 3.3515, 6.6018, 3.36);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.distance_km).toBe('number');
    expect(typeof res.body.data.fee_naira).toBe('number');
    expect(res.body.data.fee_naira).toBe(500 + Math.round(distance * 150));
  });

  it.each([
    ['missing vendorId', { customerAddress: 'Somewhere' }],
    ['missing customerAddress', { vendorId: 1 }],
  ])('rejects a request with %s with a 400', async (label, body) => {
    const res = await request(app).post('/api/delivery/quote').set('x-api-key', process.env.API_KEY).send(body);

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown vendor', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app)
      .post('/api/delivery/quote').set('x-api-key', process.env.API_KEY)
      .send({ vendorId: 999, customerAddress: 'Somewhere' });

    expect(res.status).toBe(404);
  });

  it('returns 422 when the vendor has no coordinates', async () => {
    pool.query.mockResolvedValueOnce([[{ ...vendor, latitude: null, longitude: null }]]);

    const res = await request(app)
      .post('/api/delivery/quote').set('x-api-key', process.env.API_KEY)
      .send({ vendorId: 1, customerAddress: 'Somewhere' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when the address is beyond the maximum delivery range', async () => {
    pool.query.mockResolvedValueOnce([[vendor]]);
    resolveAddress.mockResolvedValueOnce({
      normalizedAddress: 'Far Away, Lagos, Nigeria',
      latitude: 40,
      longitude: -74,
      confidence: 'high',
      source: 'nominatim',
    });

    const res = await request(app)
      .post('/api/delivery/quote').set('x-api-key', process.env.API_KEY)
      .send({ vendorId: 1, customerAddress: 'Far Away' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/maximum range/);
  });
});
