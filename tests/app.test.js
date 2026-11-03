require('./setup');
const request = require('supertest');
const createApp = require('../src/app');

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigin = process.env.CORS_ORIGIN;

function restoreEnv() {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalCorsOrigin === undefined) {
    delete process.env.CORS_ORIGIN;
  } else {
    process.env.CORS_ORIGIN = originalCorsOrigin;
  }
}

describe('CORS configuration', () => {
  afterEach(restoreEnv);

  it('allows cross-origin requests by default outside production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.CORS_ORIGIN;

    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('allows no cross-origin requests in production without CORS_ORIGIN', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;

    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows only configured origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://one.example, https://two.example';

    const allowed = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://two.example');
    const blocked = await request(createApp())
      .get('/api/health')
      .set('Origin', 'https://three.example');

    expect(allowed.headers['access-control-allow-origin']).toBe('https://two.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('JSON body limit', () => {
  it('rejects bodies larger than 100kb', async () => {
    const res = await request(createApp())
      .post('/api/addresses/resolve')
      .send({ rawAddress: 'x'.repeat(110 * 1024) });

    expect(res.status).toBe(413);
  });
});
