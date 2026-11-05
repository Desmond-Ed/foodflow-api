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

const originalRedisUrl = process.env.REDIS_URL;
const originalKeyPrefix = process.env.REDIS_KEY_PREFIX;

delete process.env.REDIS_URL;
delete process.env.REDIS_KEY_PREFIX;

const { createClient } = require('redis');
const {
  buildRedisOptions,
  cacheKey,
  connectRedis,
  decodeCertificate,
  isRedisEnabled,
  redisClient,
} = require('../src/config/redis');

afterAll(() => {
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
  if (originalKeyPrefix === undefined) {
    delete process.env.REDIS_KEY_PREFIX;
  } else {
    process.env.REDIS_KEY_PREFIX = originalKeyPrefix;
  }
});

describe('optional redis', () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_KEY_PREFIX;
    createClient.mockClear();
  });

  it('treats a missing or blank REDIS_URL as disabled', () => {
    expect(isRedisEnabled({})).toBe(false);
    expect(isRedisEnabled({ REDIS_URL: '' })).toBe(false);
    expect(isRedisEnabled({ REDIS_URL: '   ' })).toBe(false);
    expect(isRedisEnabled({ REDIS_URL: 'redis://localhost:6379' })).toBe(true);
  });

  it('does not create a client or connect when REDIS_URL is unset', async () => {
    expect(redisClient).toBeNull();
    expect(createClient).not.toHaveBeenCalled();

    await expect(connectRedis()).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates and connects a client when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';

    let loaded;
    jest.isolateModules(() => {
      loaded = require('../src/config/redis');
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0][0].url).toBe('redis://localhost:6379');
    expect(loaded.redisClient).not.toBeNull();

    await expect(loaded.connectRedis()).resolves.toBe(true);
    expect(loaded.redisClient.connect).toHaveBeenCalledTimes(1);
  });
});

describe('redis configuration', () => {
  it('does not build options without REDIS_URL', () => {
    expect(buildRedisOptions({})).toBeNull();
  });

  it('disables the offline queue and uses the configured URL', () => {
    const options = buildRedisOptions({ REDIS_URL: 'redis://localhost:6379' });

    expect(options.url).toBe('redis://localhost:6379');
    expect(options.disableOfflineQueue).toBe(true);
    expect(options.socket.connectTimeout).toBe(2000);
    expect(typeof options.socket.reconnectStrategy).toBe('function');
  });

  it('trims the configured URL', () => {
    const options = buildRedisOptions({ REDIS_URL: '  redis://localhost:6379  ' });

    expect(options.url).toBe('redis://localhost:6379');
  });

  it('keeps rediss:// URLs', () => {
    const options = buildRedisOptions({ REDIS_URL: 'rediss://redis.example.com:6379' });

    expect(options.url).toBe('rediss://redis.example.com:6379');
  });

  it('builds verified TLS options from REDIS_TLS_CA', () => {
    const options = buildRedisOptions({
      REDIS_URL: 'rediss://redis.example.com:6379',
      REDIS_TLS_CA: '-----BEGIN CERTIFICATE-----\\nline-one\\n-----END CERTIFICATE-----',
    });

    expect(options.socket.tls).toBe(true);
    expect(options.socket.rejectUnauthorized).toBe(true);
    expect(options.socket.ca).toBe('-----BEGIN CERTIFICATE-----\nline-one\n-----END CERTIFICATE-----');
  });

  it('does not force TLS without REDIS_TLS_CA', () => {
    const options = buildRedisOptions({ REDIS_URL: 'redis://localhost:6379' });

    expect(options.socket.tls).toBeUndefined();
  });

  it('decodes escaped newlines', () => {
    expect(decodeCertificate('a\\nb')).toBe('a\nb');
  });
});

describe('cacheKey', () => {
  it('prefixes keys with foodflow: by default', () => {
    expect(cacheKey('vendor:1:menu', {})).toBe('foodflow:vendor:1:menu');
  });

  it('uses REDIS_KEY_PREFIX when configured', () => {
    expect(cacheKey('vendor:1:menu', { REDIS_KEY_PREFIX: 'myapp:' })).toBe(
      'myapp:vendor:1:menu'
    );
  });

  it('falls back to the default prefix when REDIS_KEY_PREFIX is blank', () => {
    expect(cacheKey('geocode:ikeja', { REDIS_KEY_PREFIX: '' })).toBe('foodflow:geocode:ikeja');
  });
});
