require('./setup');
const crypto = require('crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');

process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc123';

const app = createApp();

function signBody(bodyString) {
  return crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(bodyString).digest('hex');
}

function mockConnection(queryResponses) {
  return {
    beginTransaction: jest.fn(),
    query: jest.fn().mockImplementation(() => Promise.resolve(queryResponses.shift())),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

describe('API key protection', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects a protected route without a key', async () => {
    const res = await request(app).get('/api/orders/1');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a protected route with the wrong key', async () => {
    const res = await request(app).get('/api/orders/1').set('x-api-key', 'wrong-key');

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('allows a protected route with the right key', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    const res = await request(app)
      .get('/api/orders/1')
      .set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('fails closed when API_KEY is not configured', async () => {
    const configuredKey = process.env.API_KEY;
    delete process.env.API_KEY;

    const res = await request(app).get('/api/orders/1').set('x-api-key', configuredKey);

    process.env.API_KEY = configuredKey;

    expect(res.status).toBe(401);
  });

  it('protects payment initialization', async () => {
    const res = await request(app)
      .post('/api/payments/initialize')
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(401);
  });

  it('protects payment status checks', async () => {
    const res = await request(app).get('/api/payments/1/status');

    expect(res.status).toBe(401);
  });
});

describe('public routes', () => {
  afterEach(() => jest.clearAllMocks());

  it('allows vendors without a key', async () => {
    pool.query.mockResolvedValueOnce([[]]);

    const res = await request(app).get('/api/vendors');

    expect(res.status).toBe(200);
  });

  it('allows health without a key', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });

  it('allows the webhook without a key', async () => {
    const payload = {
      event: 'charge.success',
      data: { id: 1, reference: 'foodflow_1_ref', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    pool.getConnection.mockResolvedValueOnce(
      mockConnection([
        [[undefined]],
        [{}],
        [[{ id: 10, order_id: 1, paystack_reference: 'foodflow_1_ref', amount_naira: '3500.00' }]],
        [{}],
        [{}],
      ])
    );

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
  });
});
