const express = require('express');
const { createOrder, getOrderById, updateOrderStatus } = require('../models/orderModel');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(400, `${field} is required and must be a positive integer`);
  }
  return value;
}

function parseOrderId(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'Order id must be a positive integer');
  }
  return id;
}

// POST /api/orders
router.post('/', async (req, res, next) => {
  try {
    const { customerId, vendorId, items } = req.body || {};

    requirePositiveInteger(customerId, 'customerId');
    requirePositiveInteger(vendorId, 'vendorId');

    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, 'items is required and must be a non-empty array');
    }

    if (items.length > 50) {
      throw new ApiError(400, 'An order can contain at most 50 items');
    }

    for (const item of items) {
      if (!item || !Number.isInteger(item.menuItemId) || item.menuItemId < 1) {
        throw new ApiError(400, 'Each item must have a menuItemId that is a positive integer');
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new ApiError(400, 'Each item must have a quantity that is a positive integer');
      }
      if (item.quantity > 20) {
        throw new ApiError(400, 'Each item quantity cannot exceed 20');
      }
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
    const orderId = parseOrderId(req.params.id);
    const order = await getOrderById(orderId);
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
    const orderId = parseOrderId(req.params.id);
    const { status } = req.body;
    if (!status) {
      throw new ApiError(400, 'status is required');
    }
    const updated = await updateOrderStatus(orderId, status);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
