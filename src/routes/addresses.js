const express = require('express');
const { resolveAddress } = require('../services/geocodingService');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// POST /api/addresses/resolve
// Body: { rawAddress } -> normalized address + lat/lng + confidence
router.post('/resolve', async (req, res, next) => {
  try {
    const { rawAddress } = req.body;

    if (!rawAddress || typeof rawAddress !== 'string') {
      throw new ApiError(400, 'rawAddress is required');
    }

    const resolved = await resolveAddress(rawAddress);
    res.json({ data: resolved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
