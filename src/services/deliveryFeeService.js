const { ApiError } = require('../middleware/errorHandler');

const EARTH_RADIUS_KM = 6371;
const BASE_FEE_NAIRA = 500;
const PER_KM_RATE_NAIRA = 150;
const MAX_DELIVERY_DISTANCE_KM = 25;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

// Standard great-circle distance formula between two lat/lng pairs.
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

// Simple tiered pricing: a flat base fee covers dispatch/handling, plus a
// per-km rate for the ride itself. Orders beyond MAX_DELIVERY_DISTANCE_KM
// are rejected outright rather than quoted a fee no rider would accept.
function calculateDeliveryFee(distanceKm) {
  if (distanceKm > MAX_DELIVERY_DISTANCE_KM) {
    throw new ApiError(
      422,
      `Delivery distance of ${distanceKm.toFixed(1)}km exceeds the maximum range of ${MAX_DELIVERY_DISTANCE_KM}km`
    );
  }

  const fee = BASE_FEE_NAIRA + distanceKm * PER_KM_RATE_NAIRA;
  return Math.round(fee);
}

module.exports = {
  haversineDistanceKm,
  calculateDeliveryFee,
  MAX_DELIVERY_DISTANCE_KM,
  BASE_FEE_NAIRA,
  PER_KM_RATE_NAIRA,
};
