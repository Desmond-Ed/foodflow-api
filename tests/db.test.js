jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(),
}));

const mysql = require('mysql2/promise');

const fakePool = { getConnection: jest.fn() };
mysql.createPool.mockReturnValue(fakePool);

const {
  checkDbConnection,
  buildSslConfig,
  buildPoolConfig,
} = require('../src/config/db');

describe('database configuration', () => {
  afterEach(() => jest.clearAllMocks());

  it('does not enable SSL without DB_SSL', () => {
    expect(buildSslConfig({})).toBeUndefined();
    expect(buildPoolConfig({}).ssl).toBeUndefined();
  });

  it('builds verified TLS options from DB_SSL_CA', () => {
    const ssl = buildSslConfig({
      DB_SSL: 'true',
      DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nline-one\\nline-two\\n-----END CERTIFICATE-----',
    });

    expect(ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nline-one\nline-two\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    });
  });

  it('refuses DB_SSL without DB_SSL_CA', () => {
    expect(() => buildSslConfig({ DB_SSL: 'true' })).toThrow(/DB_SSL_CA/);
  });

  it('uses a numeric port and production connection settings', () => {
    const config = buildPoolConfig({ DB_PORT: '3307' });

    expect(config.port).toBe(3307);
    expect(config.enableKeepAlive).toBe(true);
    expect(config.connectTimeout).toBe(10000);
  });
});

describe('checkDbConnection', () => {
  afterEach(() => jest.clearAllMocks());

  it('releases the connection when ping fails', async () => {
    const connection = {
      ping: jest.fn().mockRejectedValue(new Error('mysql unavailable')),
      release: jest.fn(),
    };
    fakePool.getConnection.mockResolvedValueOnce(connection);

    await expect(checkDbConnection()).rejects.toThrow('mysql unavailable');

    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('releases the connection when ping succeeds', async () => {
    const connection = {
      ping: jest.fn().mockResolvedValue(),
      release: jest.fn(),
    };
    fakePool.getConnection.mockResolvedValueOnce(connection);

    await checkDbConnection();

    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
