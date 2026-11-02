require('./setup');
const request = require('supertest');
const createApp = require('../src/app');
const { pool } = require('../src/config/db');
const { isWebhookRequest } = require('../src/middleware/rateLimiters');

describe('isWebhookRequest', () => {
  function reqFor(originalUrl) {
    return { originalUrl };
  }

  it('matches the exact webhook path', () => {
    expect(isWebhookRequest(reqFor('/api/payments/webhook'))).toBe(true);
  });

  it('matches the webhook path with a query string', () => {
    expect(isWebhookRequest(reqFor('/api/payments/webhook?x=1'))).toBe(true);
  });

  it('matches the webhook path with a trailing slash', () => {
    expect(isWebhookRequest(reqFor('/api/payments/webhook/'))).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(isWebhookRequest(reqFor('/api/vendors'))).toBe(false);
  });

  it('does not match a path that merely contains payments', () => {
    expect(isWebhookRequest(reqFor('/api/payments/initialize'))).toBe(false);
  });

  it('does not match a path that only contains the webhook substring', () => {
    expect(isWebhookRequest(reqFor('/api/payments/webhook-extra'))).toBe(false);
  });
});

describe('generalLimiter', () => {
  const app = createApp();

  afterEach(() => jest.clearAllMocks());

  it(
    'still applies 100 requests per minute to normal routes',
    async () => {
      pool.query.mockResolvedValue([[]]);

      const first = await request(app).get('/api/vendors');
      expect(first.status).toBe(200);

      for (let i = 1; i < 100; i += 1) {
        await request(app).get('/api/vendors');
      }

      const blocked = await request(app).get('/api/vendors');
      expect(blocked.status).toBe(429);
    },
    30000
  );
});
