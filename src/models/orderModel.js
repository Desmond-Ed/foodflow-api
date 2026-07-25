const { pool } = require('../config/db');

const VALID_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'picked_up',
  'delivered',
  'cancelled',
];

// Orders that a status is allowed to move FROM, keyed by the next status.
// This stops an order jumping straight from "pending" to "delivered", for example.
const ALLOWED_TRANSITIONS = {
  accepted: ['pending'],
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
      total += Number(menuItem.price_naira) * item.quantity;
    }

    const [orderResult] = await connection.query(
      'INSERT INTO orders (customer_id, vendor_id, status, total_naira) VALUES (?, ?, "pending", ?)',
      [customerId, vendorId, total]
    );
    const orderId = orderResult.insertId;

    for (const item of items) {
      const [[menuItem]] = await connection.query(
        'SELECT price_naira FROM menu_items WHERE id = ?',
        [item.menuItemId]
      );
      await connection.query(
        'INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_naira) VALUES (?, ?, ?, ?)',
        [orderId, item.menuItemId, item.quantity, menuItem.price_naira]
      );
    }

    await connection.commit();
    return { orderId, total };
  } catch (err) {
    await connection.rollback();
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
    throw Object.assign(new Error(`Invalid status: ${newStatus}`), { statusCode: 400 });
  }

  const order = await getOrderById(orderId);
  if (!order) {
    throw Object.assign(new Error('Order not found'), { statusCode: 404 });
  }

  const allowedFrom = ALLOWED_TRANSITIONS[newStatus];
  if (allowedFrom && !allowedFrom.includes(order.status)) {
    throw Object.assign(
      new Error(`Cannot move order from "${order.status}" to "${newStatus}"`),
      { statusCode: 409 }
    );
  }

  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [newStatus, orderId]);
  return { ...order, status: newStatus };
}

module.exports = { createOrder, getOrderById, updateOrderStatus, VALID_STATUSES };
