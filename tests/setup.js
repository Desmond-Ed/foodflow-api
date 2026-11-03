process.env.API_KEY = 'test-api-key-0123456789abcdef';

// Mocks so the test suite runs in CI/anywhere without a live MySQL or
// Redis instance. Each test file overrides the specific query responses
// it needs via jest.spyOn.
jest.mock('../src/config/db', () => ({
  pool: {
    query: jest.fn(),
    getConnection: jest.fn(),
  },
  checkDbConnection: jest.fn(),
}));

jest.mock('../src/config/redis', () => ({
  redisClient: {
    isOpen: false,
    isReady: false,
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    connect: jest.fn(),
    on: jest.fn(),
  },
  connectRedis: jest.fn(),
}));
