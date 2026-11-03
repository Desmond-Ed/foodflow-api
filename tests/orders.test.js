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
    const connection = mockConnection();
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1, quantity: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.orderId).toBe(101);
    expect(res.body.data.total).toBe(7000);
    expect(connection.query).toHaveBeenCalledTimes(3);
  });

  it('maps an unknown customer or vendor to a 400', async () => {
    const fkError = Object.assign(new Error('foreign key fails'), {
      code: 'ER_NO_REFERENCED_ROW_2',
    });
    const connection = {
      beginTransaction: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([[{ price_naira: '3500.00' }]])
        .mockRejectedValueOnce(fkError),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    pool.getConnection.mockResolvedValueOnce(connection);

    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 999, vendorId: 1, items: [{ menuItemId: 1, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Unknown customer or vendor');
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalled();
  });

  it('rejects more than 50 items with a 400', async () => {
    const items = Array.from({ length: 51 }, () => ({ menuItemId: 1, quantity: 1 }));

    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items });

    expect(res.status).toBe(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('rejects an item quantity above 20 with a 400', async () => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1, quantity: 21 }] });

    expect(res.status).toBe(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('rejects a request missing required fields with a 400', async () => {
    const res = await request(app).post('/api/orders').set('x-api-key', process.env.API_KEY).send({ customerId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/required/);
  });

  it.each([0, -1, 1.5, '2'])('rejects customerId %p with a 400', async (customerId) => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId, vendorId: 1, items: [validItem] });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '2'])('rejects vendorId %p with a 400', async (vendorId) => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId, items: [validItem] });

    expect(res.status).toBe(400);
  });

  it.each([[], 'not-an-array', null])('rejects invalid items %p with a 400', async (items) => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '2'])('rejects quantity %p with a 400', async (quantity) => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1, quantity }] });

    expect(res.status).toBe(400);
  });

  it.each([0, -1, 1.5, '1'])('rejects menuItemId %p with a 400', async (menuItemId) => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId, quantity: 2 }] });

    expect(res.status).toBe(400);
  });

  it('rejects an item with a missing quantity with a 400', async () => {
    const res = await request(app)
      .post('/api/orders').set('x-api-key', process.env.API_KEY)
      .send({ customerId: 1, vendorId: 1, items: [{ menuItemId: 1 }] });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/orders/:id', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns an existing order', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending', total_naira: 7000 }]]);

    const res = await request(app).get('/api/orders/1').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 for a missing order', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app).get('/api/orders/999').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/orders/not-a-number').set('x-api-key', process.env.API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Order id must be a positive integer');
  });
});

describe('PATCH /api/orders/:id/status', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 for a valid transition', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'accepted' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app).patch('/api/orders/1/status').set('x-api-key', process.env.API_KEY).send({ status: 'preparing' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('preparing');
  });

  it('rejects pending to accepted with a 409', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    const res = await request(app)
      .patch('/api/orders/1/status').set('x-api-key', process.env.API_KEY)
      .send({ status: 'accepted' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/payment confirmation/);
  });

  it('rejects delivered to pending with a 409', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'delivered' }]]);

    const res = await request(app)
      .patch('/api/orders/1/status').set('x-api-key', process.env.API_KEY)
      .send({ status: 'pending' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/payment confirmation/);
  });

  it('returns 400 for a bad id', async () => {
    const res = await request(app)
      .patch('/api/orders/not-a-number/status').set('x-api-key', process.env.API_KEY)
      .send({ status: 'accepted' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Order id must be a positive integer');
  });

  it('returns 400 when status is missing', async () => {
    const res = await request(app).patch('/api/orders/1/status').set('x-api-key', process.env.API_KEY).send({});

    expect(res.status).toBe(400);
  });

  it('returns 409 for an invalid transition', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    const res = await request(app).patch('/api/orders/1/status').set('x-api-key', process.env.API_KEY).send({ status: 'delivered' });

    expect(res.status).toBe(409);
  });

  it('returns 404 for a missing order', async () => {
    pool.query.mockResolvedValueOnce([[undefined]]);

    const res = await request(app).patch('/api/orders/999/status').set('x-api-key', process.env.API_KEY).send({ status: 'accepted' });

    expect(res.status).toBe(404);
  });
});

describe('updateOrderStatus (order status transitions)', () => {
  afterEach(() => jest.clearAllMocks());

  it('allows a valid transition from accepted to preparing', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'accepted' }]]) // getOrderById
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

    const result = await updateOrderStatus(1, 'preparing');
    expect(result.status).toBe('preparing');
  });

  it('rejects pending to accepted because payment confirmation owns it', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]);

    await expect(updateOrderStatus(1, 'accepted')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/payment confirmation/),
    });
  });

  it('rejects delivered to pending', async () => {
    pool.query.mockResolvedValueOnce([[{ id: 1, status: 'delivered' }]]);

    await expect(updateOrderStatus(1, 'pending')).rejects.toMatchObject({
      statusCode: 409,
    });
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
      .mockResolvedValueOnce([[{ id: 1, status: 'accepted' }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(updateOrderStatus(1, 'preparing')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
