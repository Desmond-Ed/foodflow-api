const { pool } = require('../config/db');
const { redisClient } = require('../config/redis');
const logger = require('../utils/logger');

const MENU_CACHE_TTL_SECONDS = 60;

async function getAllVendors() {
  const [rows] = await pool.query(
    'SELECT id, name, city, is_active FROM vendors WHERE is_active = TRUE'
  );
  return rows;
}

async function getVendorMenu(vendorId) {
  const cacheKey = `vendor:${vendorId}:menu`;

  // Menus don't change often, so we serve them from Redis first and only
  // fall back to MySQL on a cache miss. This is the kind of read-heavy
  // endpoint caching helps most with at scale.
  try {
    if (redisClient.isReady) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.info(`cache hit: ${cacheKey}`);
        return JSON.parse(cached);
      }
    }
  } catch (err) {
    logger.error(`redis read failed for ${cacheKey}: ${err.message}`);
  }

  const [rows] = await pool.query(
    'SELECT id, name, price_naira, is_available FROM menu_items WHERE vendor_id = ? AND is_available = TRUE',
    [vendorId]
  );

  try {
    if (redisClient.isReady) {
      await redisClient.setEx(cacheKey, MENU_CACHE_TTL_SECONDS, JSON.stringify(rows));
    }
  } catch (err) {
    logger.error(`redis write failed for ${cacheKey}: ${err.message}`);
  }

  return rows;
}

async function invalidateMenuCache(vendorId) {
  const cacheKey = `vendor:${vendorId}:menu`;
  if (redisClient.isReady) {
    await redisClient.del(cacheKey);
  }
}

// Needed by the delivery quote endpoint (Module A) to compute a
// distance/fee between a vendor and a resolved customer address.
async function getVendorById(vendorId) {
  const [[vendor]] = await pool.query(
    'SELECT id, name, city, is_active, latitude, longitude FROM vendors WHERE id = ?',
    [vendorId]
  );
  return vendor;
}

module.exports = { getAllVendors, getVendorMenu, invalidateMenuCache, getVendorById };
