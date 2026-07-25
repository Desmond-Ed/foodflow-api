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
});

describe('updateOrderStatus (order status transitions)', () => {
  afterEach(() => jest.clearAllMocks());

  it('allows a valid transition from pending to accepted', async () => {
    pool.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]) // getOrderById
      .mockResolvedValueOnce([{}]); // UPDATE

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
});
