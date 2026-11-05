require('./setup');
const crypto = require('crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

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

describe('POST /api/payments/initialize', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  function mockPaystackSuccess() {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
          reference: 'foodflow_1_abc123',
        },
      }),
    });
  }

  it('initializes a Paystack transaction for a valid order', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]]) // getOrderById
      .mockResolvedValueOnce([[undefined]]) // getPaymentByOrderId -> no prior payment
      .mockResolvedValueOnce([{}]); // createPayment insert

    mockPaystackSuccess();

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.authorizationUrl).toBe('https://checkout.paystack.com/abc123');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/transaction/initialize'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects an unknown order with a 404', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 999, email: 'customer@example.com' });

    expect(res.status).toBe(404);
  });

  it.each(['abc', 0, 1.5])('rejects orderId %p with a 400', async (orderId) => {
    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId, email: 'customer@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('orderId must be a positive integer');
  });

  it('rejects a missing email with a 400', async () => {
    const res = await request(app).post('/api/payments/initialize').set('x-api-key', process.env.API_KEY).send({ orderId: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects a request with no body instead of throwing a 500', async () => {
    global.fetch = jest.fn();

    const res = await request(app).post('/api/payments/initialize').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('orderId must be a positive integer');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(['not-an-email', 'missing-at.example.com', 'a@b'])(
    'rejects malformed email %p with a 400',
    async (email) => {
      const res = await request(app)
        .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
        .send({ orderId: 1, email });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('a valid email is required');
    }
  );

  it('rejects an order that is not pending with a 409 before calling Paystack', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'accepted' }]]);
    global.fetch = jest.fn();

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Order is not awaiting payment');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects when a payment is already pending without calling Paystack', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'pending', created_at: new Date().toISOString() }]]);
    global.fetch = jest.fn();

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('A payment is already pending for this order');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows a retry when the pending payment is older than the TTL', async () => {
    const staleCreatedAt = new Date(
      Date.now() - 31 * 60 * 1000
    ).toISOString();

    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'pending', created_at: staleCreatedAt }]])
      .mockResolvedValueOnce([{}]); // createPayment insert

    mockPaystackSuccess();

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[2][0]).toMatch(/INSERT INTO payments/);
  });

  it('rejects when the order has already been paid', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'success' }]]);

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Order has already been paid');
  });

  it('allows a retry when the latest payment failed', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]])
      .mockResolvedValueOnce([[{ id: 5, status: 'failed' }]])
      .mockResolvedValueOnce([{}]); // createPayment insert

    mockPaystackSuccess();

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[2][0]).toMatch(/INSERT INTO payments/);
  });

  it('returns 502 when the Paystack request fails or times out', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, total_naira: '3500.00', status: 'pending' }]])
      .mockResolvedValueOnce([[undefined]]); // no prior payment

    const abortError = new Error('The operation was aborted due to timeout');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValueOnce(abortError);

    const res = await request(app)
      .post('/api/payments/initialize').set('x-api-key', process.env.API_KEY)
      .send({ orderId: 1, email: 'customer@example.com' });

    expect(res.status).toBe(502);
    expect(res.body.error.message).toBe('Failed to initialize payment with Paystack');
  });
});

describe('POST /api/payments/webhook', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('accepts a validly signed charge.success event and updates the order', async () => {
    const payload = {
      event: 'charge.success',
      data: { id: 555, reference: 'foodflow_1_abc123', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const connection = mockConnection([
      [[undefined]], // SELECT processed_webhook_events -> not found
      [{}], // INSERT processed_webhook_events
      [[{ id: 10, order_id: 1, amount_naira: '3500.00', paystack_reference: 'foodflow_1_abc123' }]], // SELECT payments
      [{ affectedRows: 1 }], // UPDATE payments
      [{ affectedRows: 1 }], // UPDATE orders
    ]);
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const orderUpdate = connection.query.mock.calls.find(([sql]) =>
      /UPDATE orders SET status = 'accepted'/.test(sql)
    );
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate[1]).toEqual([1]);
  });

  it('logs an error when a successful payment is for an order that is no longer pending', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const payload = {
      event: 'charge.success',
      data: { id: 563, reference: 'foodflow_1_abc123', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const connection = mockConnection([
      [[undefined]], // SELECT processed_webhook_events -> not found
      [{}], // INSERT processed_webhook_events
      [[{ id: 10, order_id: 1, amount_naira: '3500.00', paystack_reference: 'foodflow_1_abc123' }]], // SELECT payments
      [{ affectedRows: 1 }], // UPDATE payments
      [{ affectedRows: 0 }], // UPDATE orders -> order is not pending
    ]);
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      'paid order not pending, manual refund needed: order 1, reference foodflow_1_abc123'
    );
  });

  it('acknowledges an unknown payment reference with a 200 and a warn log', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const payload = {
      event: 'charge.success',
      data: { id: 564, reference: 'unknown_reference', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const connection = mockConnection([
      [[undefined]], // SELECT processed_webhook_events -> not found
      [{}], // INSERT processed_webhook_events
      [[undefined]], // SELECT payments -> unknown reference
    ]);
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: true });
    expect(connection.rollback).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown reference'));
  });

  it('ignores events other than charge.success without touching the database', async () => {
    const payload = {
      event: 'charge.failed',
      data: { id: 560, reference: 'foodflow_1_abc123' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: true });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amount: 100, currency: 'NGN' }],
    ['currency', { amount: 350000, currency: 'USD' }],
  ])('ignores a charge.success with a mismatched %s', async (_label, overrides) => {
    const payload = {
      event: 'charge.success',
      data: { id: 561, reference: 'foodflow_1_abc123', ...overrides },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const connection = mockConnection([
      [[undefined]], // SELECT processed_webhook_events -> not found
      [{}], // INSERT processed_webhook_events
      [[{ id: 10, order_id: 1, amount_naira: '3500.00', paystack_reference: 'foodflow_1_abc123' }]], // SELECT payments
    ]);
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ignored: true });
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();

    const orderUpdate = connection.query.mock.calls.find(([sql]) =>
      /UPDATE orders SET status = 'accepted'/.test(sql)
    );
    expect(orderUpdate).toBeUndefined();
  });

  it('does not overwrite a payment that is no longer pending', async () => {
    const payload = {
      event: 'charge.success',
      data: { id: 562, reference: 'foodflow_1_abc123', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const connection = mockConnection([
      [[undefined]], // SELECT processed_webhook_events -> not found
      [{}], // INSERT processed_webhook_events
      [[{ id: 10, order_id: 1, amount_naira: '3500.00', status: 'success', paystack_reference: 'foodflow_1_abc123' }]], // SELECT payments
      [{ affectedRows: 0 }], // UPDATE payments guarded by status = 'pending'
    ]);
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();

    const orderUpdate = connection.query.mock.calls.find(([sql]) =>
      /UPDATE orders SET status = 'accepted'/.test(sql)
    );
    expect(orderUpdate).toBeUndefined();
  });

  it('rejects a tampered payload with a 401', async () => {
    const payload = { event: 'charge.success', data: { id: 556, reference: 'foodflow_1_abc123' } };
    const rawBody = JSON.stringify(payload);
    const validSignature = signBody(rawBody);

    const tamperedBody = JSON.stringify({ ...payload, data: { ...payload.data, reference: 'hijacked' } });

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', validSignature)
      .set('Content-Type', 'application/json')
      .send(tamperedBody);

    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature header at all', async () => {
    const payload = { event: 'charge.success', data: { id: 557, reference: 'foodflow_1_abc123' } };

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
  });

  it('processes the same event_id only once (idempotency)', async () => {
    const payload = {
      event: 'charge.success',
      data: { id: 558, reference: 'foodflow_1_abc123', amount: 350000, currency: 'NGN' },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    // First delivery: event not yet seen, gets processed fully.
    pool.getConnection.mockResolvedValueOnce(
      mockConnection([
        [[undefined]],
        [{}],
        [[{ id: 10, order_id: 1, amount_naira: '3500.00', paystack_reference: 'foodflow_1_abc123' }]],
        [{ affectedRows: 1 }],
        [{ affectedRows: 1 }],
      ])
    );

    const firstRes = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(firstRes.status).toBe(200);

    // Second delivery of the exact same event (Paystack retry): event_id
    // already exists, so this must short-circuit to a no-op.
    const secondConnection = mockConnection([[[{ id: 1 }]]]); // SELECT finds an existing row
    pool.getConnection.mockResolvedValueOnce(secondConnection);

    const secondRes = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(secondRes.status).toBe(200);
    expect(secondConnection.rollback).toHaveBeenCalled();
    // Only the existence check ran - no insert/update queries followed it.
    expect(secondConnection.query).toHaveBeenCalledTimes(1);
  });
});

describe('processPaymentWebhookEvent under real concurrency', () => {
  afterEach(() => jest.clearAllMocks());

  it('resolves both calls cleanly when two deliveries of the same event race each other', async () => {
    const { processPaymentWebhookEvent } = require('../src/models/paymentModel');

    // Connection A "wins" the race: its SELECT sees no existing event, and
    // its INSERT succeeds, so it proceeds to do the real payment/order updates.
    const connectionA = {
      beginTransaction: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([[undefined]]) // SELECT processed_webhook_events -> not found
        .mockResolvedValueOnce([{}]) // INSERT succeeds
        .mockResolvedValueOnce([[{ id: 10, order_id: 1, amount_naira: '3500.00', paystack_reference: 'foodflow_1_race' }]]) // SELECT payment
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE payments
        .mockResolvedValueOnce([{ affectedRows: 1 }]), // UPDATE orders
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };

    // Connection B "loses" the race: its SELECT also sees no existing event
    // (this is the actual race - both checks happen before either commits),
    // but by the time its INSERT runs, A's has already committed, so MySQL's
    // UNIQUE constraint on event_id rejects it with ER_DUP_ENTRY.
    const dupError = Object.assign(new Error("Duplicate entry 'evt_race' for key 'event_id'"), {
      code: 'ER_DUP_ENTRY',
    });
    const connectionB = {
      beginTransaction: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([[undefined]]) // SELECT -> also not found (the race)
        .mockRejectedValueOnce(dupError), // INSERT loses the race
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };

    pool.getConnection.mockResolvedValueOnce(connectionA).mockResolvedValueOnce(connectionB);

    const eventPayload = {
      eventId: 'evt_race',
      eventType: 'charge.success',
      reference: 'foodflow_1_race',
      succeeded: true,
      amount: 350000,
      currency: 'NGN',
    };

    // Fire both concurrently, the way two near-simultaneous Paystack retries would arrive.
    const [resultA, resultB] = await Promise.all([
      processPaymentWebhookEvent(eventPayload),
      processPaymentWebhookEvent(eventPayload),
    ]);

    // Neither call should throw. Exactly one processed it for real, the
    // other must resolve as alreadyProcessed instead of erroring.
    expect([resultA.alreadyProcessed, resultB.alreadyProcessed].sort()).toEqual([false, true]);
    expect(connectionB.rollback).toHaveBeenCalled();
    expect(connectionA.commit).toHaveBeenCalled();
  });
});

describe('GET /api/payments/:orderId/status', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the payment status for an order', async () => {
    pool.query.mockResolvedValueOnce([
      [{ order_id: 1, paystack_reference: 'foodflow_1_abc123', status: 'success', amount_naira: '3500.00' }],
    ]);

    const res = await request(app).get('/api/payments/1/status').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('success');
  });

  it('returns a 404 when there is no payment for the order', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app).get('/api/payments/999/status').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(404);
  });
});
