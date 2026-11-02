require('./setup');

// Nominatim's real rate limit is 1 req/sec; the suite doesn't need to
// actually wait that long to prove the queueing/caching logic works.
process.env.NOMINATIM_MIN_INTERVAL_MS = '0';
process.env.NOMINATIM_USER_AGENT = 'foodflow-api-tests (test@example.com)';

const { pool } = require('../src/config/db');
const { redisClient } = require('../src/config/redis');
const { resolveAddress, normalizeAddress } = require('../src/services/geocodingService');

describe('normalizeAddress', () => {
  it('strips stray punctuation and standardizes casing', () => {
    const result = normalizeAddress('opp. NNPC filling stn, ikeja!!');
    expect(result).not.toMatch(/[!.]/);
    expect(result).toMatch(/Ikeja/);
  });

  it('appends Lagos and Nigeria when missing', () => {
    const result = normalizeAddress('12 Allen Avenue');
    expect(result).toMatch(/Lagos/);
    expect(result).toMatch(/Nigeria/);
  });

  it('does not duplicate Lagos if already present', () => {
    const result = normalizeAddress('12 Allen Avenue, Lagos');
    expect(result.match(/Lagos/g)).toHaveLength(1);
  });
});

describe('resolveAddress', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('rejects a missing rawAddress with a 400', async () => {
    await expect(resolveAddress('')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns a Redis cache hit without calling Nominatim', async () => {
    redisClient.isOpen = true;
    redisClient.get.mockResolvedValueOnce(
      JSON.stringify({
        normalized_address: '12 Allen Avenue, Lagos, Nigeria',
        latitude: '6.6018000',
        longitude: '3.3490000',
        confidence: 'high',
      })
    );
    global.fetch = jest.fn();

    const result = await resolveAddress('12 Allen Avenue');

    expect(result.source).toBe('cache');
    expect(result.latitude).toBeCloseTo(6.6018);
    expect(global.fetch).not.toHaveBeenCalled();

    redisClient.isOpen = false;
  });

  it('falls back to the MySQL cache when Redis misses', async () => {
    redisClient.isOpen = false;
    pool.query.mockResolvedValueOnce([
      [
        {
          normalized_address: '12 Allen Avenue, Lagos, Nigeria',
          latitude: '6.6018000',
          longitude: '3.3490000',
          confidence: 'high',
        },
      ],
    ]);
    global.fetch = jest.fn();

    const result = await resolveAddress('12 Allen Avenue');

    expect(result.source).toBe('cache');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('geocodes via Nominatim on a full cache miss and caches the result', async () => {
    redisClient.isOpen = true;
    redisClient.get.mockResolvedValueOnce(null);
    pool.query
      .mockResolvedValueOnce([[]]) // DB cache miss
      .mockResolvedValueOnce([{}]); // INSERT ... ON DUPLICATE KEY UPDATE
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lat: '6.6018', lon: '3.3515' }],
    });

    const result = await resolveAddress('Some New Unseen Street, Lagos');

    expect(result.source).toBe('nominatim');
    expect(result.confidence).toBe('high');
    expect(result.latitude).toBeCloseTo(6.6018);
    expect(redisClient.setEx).toHaveBeenCalled();

    const [[url, options]] = global.fetch.mock.calls;
    expect(url).toContain('nominatim.openstreetmap.org');
    expect(options.headers['User-Agent']).toBe('foodflow-api-tests (test@example.com)');
  });

  it('falls back to the landmark table when Nominatim returns nothing', async () => {
    redisClient.isOpen = false;
    pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{}]);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    const result = await resolveAddress('Opposite Ikeja City Mall, no house number');

    expect(result.source).toBe('landmark');
    expect(result.confidence).toBe('medium');
    expect(result.latitude).toBeCloseTo(6.6018);
  });

  it('falls back to the landmark table when Nominatim times out', async () => {
    redisClient.isOpen = false;
    pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{}]);
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValueOnce(timeoutError);

    const result = await resolveAddress('Opposite Ikeja City Mall, no house number');

    expect(result.source).toBe('landmark');
    expect(result.confidence).toBe('medium');
    expect(global.fetch.mock.calls[0][1].signal).toBeDefined();
  });

  it('throws a 422 when nothing matches and Nominatim has nothing', async () => {
    redisClient.isOpen = false;
    pool.query.mockResolvedValueOnce([[]]);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await expect(resolveAddress('Completely made up nonexistent place')).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});
