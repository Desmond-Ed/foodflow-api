const express = require('express');
const { createOrder, getOrderById, updateOrderStatus } = require('../models/orderModel');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// POST /api/orders
router.post('/', async (req, res, next) => {
  try {
    const { customerId, vendorId, items } = req.body;

    if (!customerId || !vendorId || !Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'customerId, vendorId and a non-empty items array are required');
    }

    const result = await createOrder({ customerId, vendorId, items });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(Number(req.params.id));
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }
    res.json({ data: order });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) {
      throw new ApiError(400, 'status is required');
    }
    const updated = await updateOrderStatus(Number(req.params.id), status);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
