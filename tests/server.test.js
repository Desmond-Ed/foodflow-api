jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/app', () => jest.fn());
jest.mock('../src/config/db', () => ({ pool: { end: jest.fn() }, checkDbConnection: jest.fn() }));
jest.mock('../src/config/redis', () => ({
  redisClient: { isReady: false, quit: jest.fn() },
  connectRedis: jest.fn(),
  isRedisEnabled: jest.fn(() => true),
}));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const { createShutdownHandler, assertProductionApiKey } = require('../src/server');

describe('assertProductionApiKey', () => {
  it('allows a missing key outside production', () => {
    expect(() => assertProductionApiKey({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('refuses to start in production without a key', () => {
    expect(() => assertProductionApiKey({ NODE_ENV: 'production' })).toThrow(/API_KEY/);
  });

  it('refuses to start in production with a short key', () => {
    expect(() =>
      assertProductionApiKey({ NODE_ENV: 'production', API_KEY: 'too-short' })
    ).toThrow(/API_KEY/);
  });

  it('allows a long key in production', () => {
    expect(() =>
      assertProductionApiKey({
        NODE_ENV: 'production',
        API_KEY: '0123456789abcdef0123456789abcdef',
      })
    ).not.toThrow();
  });
});

describe('createShutdownHandler', () => {
  function buildDeps(overrides = {}) {
    return {
      server: { close: jest.fn((cb) => cb()) },
      redisClient: { isReady: true, quit: jest.fn().mockResolvedValue() },
      pool: { end: jest.fn().mockResolvedValue() },
      logger: { info: jest.fn(), error: jest.fn() },
      exit: jest.fn(),
      forceExitMs: 10000,
      ...overrides,
    };
  }

  it('closes the server, quits Redis, and ends the pool', async () => {
    const deps = buildDeps();
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGTERM');

    expect(deps.server.close).toHaveBeenCalledTimes(1);
    expect(deps.redisClient.quit).toHaveBeenCalledTimes(1);
    expect(deps.pool.end).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('does not quit Redis when it is not ready', async () => {
    const deps = buildDeps({ redisClient: { isReady: false, quit: jest.fn() } });
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGINT');

    expect(deps.redisClient.quit).not.toHaveBeenCalled();
    expect(deps.pool.end).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('does not touch Redis when it is disabled', async () => {
    const deps = buildDeps({ redisClient: null });
    const shutdown = createShutdownHandler(deps);

    await shutdown('SIGTERM');

    expect(deps.pool.end).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('forces an exit after the timeout', () => {
    jest.useFakeTimers();
    const deps = buildDeps({ server: { close: jest.fn() } });
    const shutdown = createShutdownHandler(deps);

    shutdown('SIGTERM');
    jest.advanceTimersByTime(10000);

    expect(deps.exit).toHaveBeenCalledWith(1);
    jest.useRealTimers();
  });
});
