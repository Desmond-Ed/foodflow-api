require('./setup');
const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');

const app = createApp();

describe('GET /api/vendors', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns a list of active vendors', async () => {
    pool.query.mockResolvedValueOnce([
      [
        { id: 1, name: 'Mama Nkechi Kitchen', city: 'Lagos', is_active: 1 },
        { id: 2, name: 'Chicken Republic - Ikeja', city: 'Lagos', is_active: 1 },
      ],
    ]);

    const res = await request(app).get('/api/vendors');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Mama Nkechi Kitchen');
  });
});

describe('GET /api/vendors/:id/menu', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the menu for a valid vendor id', async () => {
    pool.query.mockResolvedValueOnce([
      [{ id: 1, name: 'Jollof Rice + Chicken', price_naira: '3500.00', is_available: 1 }],
    ]);

    const res = await request(app).get('/api/vendors/1/menu');

    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Jollof Rice + Chicken');
  });

  it('rejects a non-numeric vendor id with a 400', async () => {
    const res = await request(app).get('/api/vendors/abc/menu');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/must be a number/);
  });
});
