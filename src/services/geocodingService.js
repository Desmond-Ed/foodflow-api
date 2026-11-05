const { pool } = require('../config/db');
const { cacheKey, isRedisEnabled, redisClient } = require('../config/redis');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const GEOCODE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days: coordinates for a fixed address don't move.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Nominatim's usage policy caps free use at 1 request/second. This is a
// single shared "last call" timestamp that every geocode call queues behind,
// so concurrent requests never burst past that limit no matter how many
// come in at once. Tests override the interval to 0 so the suite stays fast.
let lastNominatimCallAt = 0;
function getMinIntervalMs() {
  return Number(process.env.NOMINATIM_MIN_INTERVAL_MS ?? 1000);
}

let queueTail = Promise.resolve();
function enqueueNominatimCall(fn) {
  const runAfterWait = async () => {
    const minInterval = getMinIntervalMs();
    const waitMs = Math.max(0, lastNominatimCallAt + minInterval - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastNominatimCallAt = Date.now();
    return fn();
  };

  // Chain onto the shared tail so calls run strictly one-at-a-time, in
  // order, regardless of how many resolveAddress() calls fire concurrently.
  const result = queueTail.then(runAfterWait, runAfterWait);
  queueTail = result.catch(() => {});
  return result;
}

// A small seeded lookup of well-known Lagos/Ikeja landmarks. This is what
// catches the "opposite so-and-so" style of address that standard geocoders
// have nothing to match against: no house number, no postal code, just a
// name locals would recognize.
const LANDMARK_FALLBACKS = [
  { match: /ikeja city mall/i, name: 'Ikeja City Mall, Alausa, Ikeja, Lagos', latitude: 6.6018, longitude: 3.3515 },
  { match: /computer village/i, name: 'Computer Village, Ikeja, Lagos', latitude: 6.6010, longitude: 3.3450 },
  { match: /allen\s*avenue/i, name: 'Allen Avenue, Ikeja, Lagos', latitude: 6.6018, longitude: 3.3490 },
  { match: /opebi/i, name: 'Opebi Road, Ikeja, Lagos', latitude: 6.5975, longitude: 3.3555 },
  { match: /awolowo\s*road/i, name: 'Awolowo Road, Ikoyi, Lagos', latitude: 6.4531, longitude: 3.4230 },
  { match: /murtala\s*mohammed|mm\s*airport|airport\s*road/i, name: 'Murtala Muhammed Airport Road, Ikeja, Lagos', latitude: 6.5774, longitude: 3.3211 },
  { match: /maryland/i, name: 'Maryland, Lagos', latitude: 6.5700, longitude: 3.3670 },
  { match: /oshodi/i, name: 'Oshodi, Lagos', latitude: 6.5540, longitude: 3.3480 },
];

// Strips stray punctuation/whitespace, standardizes casing, and appends
// area/city/state if the raw string doesn't already mention Lagos or
// Nigeria. Addresses are often written inconsistently ("opp. NNPC filling
// stn, ikeja"), so normalization is what makes caching and lookups reliable.
function normalizeAddress(rawAddress) {
  let normalized = rawAddress
    .replace(/[^\w\s,-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');

  const mentionsLagos = /lagos/i.test(normalized);
  const mentionsNigeria = /nigeria/i.test(normalized);

  if (!mentionsLagos) normalized += ', Lagos';
  if (!mentionsNigeria) normalized += ', Nigeria';

  return normalized;
}

async function getFromCache(normalizedAddress) {
  const key = cacheKey(`geocode:${normalizedAddress}`);

  try {
    if (isRedisEnabled() && redisClient && redisClient.isReady) {
      const cached = await redisClient.get(key);
      if (cached) {
        logger.info(`cache hit: ${key}`);
        return JSON.parse(cached);
      }
    }
  } catch (err) {
    logger.error(`redis read failed for ${key}: ${err.message}`);
  }

  const [[row]] = await pool.query(
    'SELECT normalized_address, latitude, longitude, confidence FROM resolved_addresses WHERE normalized_address = ?',
    [normalizedAddress]
  );

  return row || null;
}

async function saveToCache(rawAddress, resolved) {
  const key = cacheKey(`geocode:${resolved.normalized_address}`);

  try {
    if (isRedisEnabled() && redisClient && redisClient.isReady) {
      await redisClient.setEx(key, GEOCODE_CACHE_TTL_SECONDS, JSON.stringify(resolved));
    }
  } catch (err) {
    logger.error(`redis write failed for ${key}: ${err.message}`);
  }

  try {
    await pool.query(
      `INSERT INTO resolved_addresses (raw_address, normalized_address, latitude, longitude, confidence)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude), confidence = VALUES(confidence)`,
      [rawAddress, resolved.normalized_address, resolved.latitude, resolved.longitude, resolved.confidence]
    );
  } catch (err) {
    logger.error(`failed to persist resolved address: ${err.message}`);
  }
}

async function queryNominatim(normalizedAddress) {
  return enqueueNominatimCall(async () => {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(normalizedAddress)}`;
    const timeoutMs = Number(process.env.NOMINATIM_TIMEOUT_MS) || 5000;

    const response = await fetch(url, {
      headers: {
        // Nominatim's policy requires a custom User-Agent identifying the
        // application and a contact point - an unidentified client can get
        // blocked outright.
        'User-Agent': process.env.NOMINATIM_USER_AGENT || 'foodflow-api (contact@example.com)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      logger.error(`nominatim request failed with status ${response.status}`);
      return null;
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    return {
      latitude: Number(results[0].lat),
      longitude: Number(results[0].lon),
    };
  });
}

function matchLandmark(rawAddress) {
  return LANDMARK_FALLBACKS.find((landmark) => landmark.match.test(rawAddress)) || null;
}

// Resolves a raw, messy address string into normalized text + coordinates.
// Order of resolution: cache (Redis, then MySQL) -> Nominatim -> seeded
// landmark table -> give up with a 422. Cache is checked first every time,
// since geocoding the same address twice wastes latency and burns through
// Nominatim's rate limit for no reason.
async function resolveAddress(rawAddress) {
  if (!rawAddress || typeof rawAddress !== 'string' || rawAddress.trim().length === 0) {
    throw new ApiError(400, 'rawAddress is required');
  }

  const normalized = normalizeAddress(rawAddress);

  const cached = await getFromCache(normalized);
  if (cached) {
    return {
      normalizedAddress: cached.normalized_address,
      latitude: Number(cached.latitude),
      longitude: Number(cached.longitude),
      confidence: cached.confidence,
      source: 'cache',
    };
  }

  let coords = null;
  let confidence = 'high';
  let source = 'nominatim';

  try {
    coords = await queryNominatim(normalized);
  } catch (err) {
    logger.error(`nominatim call errored: ${err.message}`);
  }

  if (!coords) {
    const landmark = matchLandmark(rawAddress);
    if (landmark) {
      coords = { latitude: landmark.latitude, longitude: landmark.longitude };
      confidence = 'medium';
      source = 'landmark';
    }
  }

  if (!coords) {
    throw new ApiError(422, 'Could not resolve this address to a location');
  }

  const resolved = {
    normalized_address: normalized,
    latitude: coords.latitude,
    longitude: coords.longitude,
    confidence,
  };

  await saveToCache(rawAddress, resolved);

  return {
    normalizedAddress: normalized,
    latitude: coords.latitude,
    longitude: coords.longitude,
    confidence,
    source,
  };
}

module.exports = { resolveAddress, normalizeAddress, matchLandmark };
