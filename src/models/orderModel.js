const { pool } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

const VALID_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'picked_up',
  'delivered',
  'cancelled',
];

const PAYMENT_ONLY_STATUSES = new Set(['pending', 'accepted']);

// Orders that a status is allowed to move FROM, keyed by the next status.
// "accepted" is deliberately absent: only the payment webhook can set it.
const ALLOWED_TRANSITIONS = {
  preparing: ['accepted'],
  picked_up: ['preparing'],
  delivered: ['picked_up'],
  cancelled: ['pending', 'accepted', 'preparing'],
};

async function createOrder({ customerId, vendorId, items }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let total = 0;
    const pricedItems = [];

    for (const item of items) {
      const [[menuItem]] = await connection.query(
        'SELECT price_naira FROM menu_items WHERE id = ? AND vendor_id = ? AND is_available = TRUE',
        [item.menuItemId, vendorId]
      );
      if (!menuItem) {
        throw Object.assign(
          new Error(`Menu item ${item.menuItemId} is unavailable for this vendor`),
          { statusCode: 400 }
        );
      }

      pricedItems.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPriceNaira: menuItem.price_naira,
      });
      total += Number(menuItem.price_naira) * item.quantity;
    }

    const [orderResult] = await connection.query(
      'INSERT INTO orders (customer_id, vendor_id, status, total_naira) VALUES (?, ?, "pending", ?)',
      [customerId, vendorId, total]
    );
    const orderId = orderResult.insertId;

    for (const item of pricedItems) {
      await connection.query(
        'INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_naira) VALUES (?, ?, ?, ?)',
        [orderId, item.menuItemId, item.quantity, item.unitPriceNaira]
      );
    }

    await connection.commit();
    return { orderId, total };
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new ApiError(400, 'Unknown customer or vendor');
    }
    throw err;
  } finally {
    connection.release();
  }
}

async function getOrderById(orderId) {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  return order;
}

async function updateOrderStatus(orderId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new ApiError(400, `Invalid status: ${newStatus}`);
  }

  const order = await getOrderById(orderId);
  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  if (PAYMENT_ONLY_STATUSES.has(newStatus)) {
    throw new ApiError(
      409,
      'Orders cannot be set to "pending" or "accepted" via this endpoint; "accepted" is set only by payment confirmation'
    );
  }

  const allowedFrom = ALLOWED_TRANSITIONS[newStatus];
  if (allowedFrom && !allowedFrom.includes(order.status)) {
    throw new ApiError(409, `Cannot move order from "${order.status}" to "${newStatus}"`);
  }

  const [result] = await pool.query(
    'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
    [newStatus, orderId, order.status]
  );
  if (result.affectedRows === 0) {
    throw new ApiError(409, 'Order status was changed concurrently; please retry');
  }

  return { ...order, status: newStatus };
}

module.exports = { createOrder, getOrderById, updateOrderStatus, VALID_STATUSES };
