const express = require('express');
const { resolveAddress } = require('../services/geocodingService');
const { haversineDistanceKm, calculateDeliveryFee } = require('../services/deliveryFeeService');
const { getVendorById } = require('../models/vendorModel');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// POST /api/delivery/quote
// Body: { vendorId, customerAddress } -> { distance_km, fee_naira }
router.post('/quote', async (req, res, next) => {
  try {
    const { vendorId, customerAddress } = req.body;

    if (!vendorId || !customerAddress) {
      throw new ApiError(400, 'vendorId and customerAddress are required');
    }

    const vendor = await getVendorById(Number(vendorId));
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found');
    }
    if (vendor.latitude === null || vendor.longitude === null) {
      throw new ApiError(422, 'Vendor has no known location on file');
    }

    const resolved = await resolveAddress(customerAddress);

    const distanceKm = haversineDistanceKm(
      Number(vendor.latitude),
      Number(vendor.longitude),
      resolved.latitude,
      resolved.longitude
    );
    const feeNaira = calculateDeliveryFee(distanceKm);

    res.json({
      data: {
        vendorId: vendor.id,
        distance_km: Number(distanceKm.toFixed(2)),
        fee_naira: feeNaira,
        resolvedAddress: resolved,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
