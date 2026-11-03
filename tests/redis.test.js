jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    isOpen: false,
    connect: jest.fn(),
  })),
}));

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
}));

const { buildRedisOptions, decodeCertificate } = require('../src/config/redis');

describe('redis configuration', () => {
  it('disables the offline queue and uses the default URL', () => {
    const options = buildRedisOptions({});

    expect(options.url).toBe('redis://localhost:6379');
    expect(options.disableOfflineQueue).toBe(true);
    expect(options.socket.connectTimeout).toBe(2000);
    expect(typeof options.socket.reconnectStrategy).toBe('function');
  });

  it('keeps rediss:// URLs', () => {
    const options = buildRedisOptions({ REDIS_URL: 'rediss://redis.example.com:6379' });

    expect(options.url).toBe('rediss://redis.example.com:6379');
  });

  it('builds verified TLS options from REDIS_TLS_CA', () => {
    const options = buildRedisOptions({
      REDIS_TLS_CA: '-----BEGIN CERTIFICATE-----\\nline-one\\n-----END CERTIFICATE-----',
    });

    expect(options.socket.tls).toBe(true);
    expect(options.socket.rejectUnauthorized).toBe(true);
    expect(options.socket.ca).toBe('-----BEGIN CERTIFICATE-----\nline-one\n-----END CERTIFICATE-----');
  });

  it('does not force TLS without REDIS_TLS_CA', () => {
    const options = buildRedisOptions({});

    expect(options.socket.tls).toBeUndefined();
  });

  it('decodes escaped newlines', () => {
    expect(decodeCertificate('a\\nb')).toBe('a\nb');
  });
});
