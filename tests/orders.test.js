require('./setup');
const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');
const { updateOrderStatus } = require('../src/models/orderModel');

const app = createApp();

function mockConnection({ menuItemPrice = '3500.00', insertId = 101 } = {}) {
  return {
    beginTransaction: jest.fn(),
    query: jest
      .fn()
      // price lookup during total calculation
      .mockResolvedValueOnce([[{ price_naira: menuItemPrice }]])
      // insert into orders
      .mockResolvedValueOnce([{ insertId }])
      // price lookup again for order_items insert
      .mockResolvedValueOnce([[{ price_naira: menuItemPrice }]])
      // insert into order_items
      .mockResolvedValueOnce([{}]),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
}

const validItem = { menuItemId: 1, quantity: 2 };

describe('POST /api/orders', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates an order and returns its total', async () => {
    pool.getConnection.mockResolvedValueOnce(mockConnection());

    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1, quantity: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.orderId).toBe(101);
    expect(res.body.data.total).toBe(7000);
  });

  it('rejects a request missing required fields with a 400', async () => {
    const res = await request(app).post('/api/orders').send({ customerId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/required/);
  });

  it.each([0, -1, 1.5, '2'])('rejects customerId %p with a 400', async (customerId) => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId, vendorId: 1, items: [validItem] });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '2'])('rejects vendorId %p with a 400', async (vendorId) => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId, items: [validItem] });

    expect(res.status).toBe(400);
  });

  it.each([[], 'not-an-array', null])('rejects invalid items %p with a 400', async (items) => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId: 1, items });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '2'])('rejects quantity %p with a 400', async (quantity) => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1, quantity }] });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '1'])('rejects menuItemId %p with a 400', async (menuItemId) => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId, quantity: 2 }] });

    expect(res.status).toBe(400);
  });

  it('rejects an item with a missing quantity with a 400', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1 }] });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/orders/:id', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns an existing order', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending', total_naira: 7000 }]]);

    const res = await request(app).get('/api/orders/1');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 for a missing order', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app).get('/api/orders/999');

    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/orders/not-a-number');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Order id must be a positive integer');
  });
});

describe('PATCH /api/orders/:id/status', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 for a valid transition', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app).patch('/api/orders/1/status').send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');
  });

  it('returns 400 for a bad id', async () => {
    const res = await request(app)
      .patch('/api/orders/not-a-number/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Order id must be a positive integer');
  });

  it('returns 400 when status is missing', async () => {
    const res = await request(app).patch('/api/orders/1/status').send({});

    expect(res.status).toBe(400);
  });

  it('returns 409 for an invalid transition', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    const res = await request(app).patch('/api/orders/1/status').send({ status: 'delivered' });

    expect(res.status).toBe(409);
  });

  it('returns 404 for a missing order', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app).patch('/api/orders/999/status').send({ status: 'accepted' });

    expect(res.status).toBe(404);
  });
});

describe('updateOrderStatus (order status transitions)', () => {
  afterEach(() => jest.clearAllMocks());

  it('allows a valid transition from pending to accepted', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]) // getOrderById
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

    const result = await updateOrderStatus(1, 'accepted');
    expect(result.status).toBe('accepted');
  });

  it('rejects an invalid transition from pending straight to delivered', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    await expect(updateOrderStatus(1, 'delivered')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects an unknown order id with a 404', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    await expect(updateOrderStatus(999, 'accepted')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('returns a 409 when the status changed concurrently', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(updateOrderStatus(1, 'accepted')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
