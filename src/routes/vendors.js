const express = require('express');
const { getAllVendors, getVendorMenu } = require('../models/vendorModel');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/vendors
router.get('/', async (req, res, next) => {
  try {
    const vendors = await getAllVendors();
    res.json({ data: vendors });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendors/:id/menu
router.get('/:id/menu', async (req, res, next) => {
  try {
    const vendorId = Number(req.params.id);
    if (!Number.isInteger(vendorId)) {
      throw new ApiError(400, 'Vendor id must be a number');
    }
    const menu = await getVendorMenu(vendorId);
    res.json({ data: menu });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
