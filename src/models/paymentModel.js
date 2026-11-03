const { pool } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

async function createPayment({ orderId, reference, amountNaira }) {
  await pool.query(
    'INSERT INTO payments (order_id, paystack_reference, amount_naira, status) VALUES (?, ?, ?, "pending")',
    [orderId, reference, amountNaira]
  );
}

async function getPaymentByOrderId(orderId) {
  const [[payment]] = await pool.query(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  return payment;
}

async function getPaymentByReference(reference) {
  const [[payment]] = await pool.query(
    'SELECT * FROM payments WHERE paystack_reference = ?',
    [reference]
  );
  return payment;
}

// Records the webhook event and updates payment + order status inside a
// single transaction, so a crash between the two steps can never leave
// them inconsistent (e.g. event marked processed but order still pending).
// If the event_id already exists, the whole thing is a no-op: Paystack
// retries on timeout, so the same event can legitimately arrive twice.
async function processPaymentWebhookEvent({ eventId, eventType, reference, succeeded, amount, currency }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [[existingEvent]] = await connection.query(
      'SELECT id FROM processed_webhook_events WHERE event_id = ?',
      [eventId]
    );

    if (existingEvent) {
      await connection.rollback();
      return { alreadyProcessed: true };
    }

    try {
      await connection.query(
        'INSERT INTO processed_webhook_events (event_id, event_type) VALUES (?, ?)',
        [eventId, eventType]
      );
    } catch (insertErr) {
      // Check-then-act race: two deliveries of the same event_id can both
      // pass the SELECT above before either commits, if Paystack's retry
      // fires close enough together. MySQL's UNIQUE constraint on event_id
      // is the real source of truth here - whichever INSERT loses the race
      // gets ER_DUP_ENTRY, and that means "someone else already processed
      // this," which is exactly the same outcome as the SELECT finding it.
      if (insertErr.code === 'ER_DUP_ENTRY') {
        await connection.rollback();
        return { alreadyProcessed: true };
      }
      throw insertErr;
    }

    const [[payment]] = await connection.query(
      'SELECT * FROM payments WHERE paystack_reference = ?',
      [reference]
    );

    if (!payment) {
      await connection.rollback();
      throw new ApiError(404, `No payment found for reference ${reference}`);
    }

    const expectedAmount = Math.round(Number(payment.amount_naira) * 100);
    const receivedAmount = Number(amount);

    if (succeeded && (currency !== 'NGN' || receivedAmount !== expectedAmount)) {
      await connection.rollback();
      return {
        mismatch: true,
        orderId: payment.order_id,
        expectedAmount,
        receivedAmount,
        currency,
      };
    }

    const newPaymentStatus = succeeded ? 'success' : 'failed';
    const [updateResult] = await connection.query(
      'UPDATE payments SET status = ? WHERE id = ? AND status = "pending"',
      [newPaymentStatus, payment.id]
    );

    // If the payment is no longer pending, another event already settled it.
    // Never overwrite a terminal status, and never accept the order from a
    // stale event.
    if (updateResult.affectedRows === 0) {
      await connection.commit();
      return { alreadyProcessed: true };
    }

    // Payment confirmation is what moves an order out of "pending" - never
    // the client-side redirect alone, since that can be spoofed or simply
    // never fire if the customer closes the tab.
    let orderNotPending = false;
    if (succeeded) {
      const [orderUpdate] = await connection.query(
        'UPDATE orders SET status = "accepted" WHERE id = ? AND status = "pending"',
        [payment.order_id]
      );
      orderNotPending = orderUpdate.affectedRows === 0;
    }

    await connection.commit();
    return {
      alreadyProcessed: false,
      orderId: payment.order_id,
      paymentStatus: newPaymentStatus,
      orderNotPending,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  createPayment,
  getPaymentByOrderId,
  getPaymentByReference,
  processPaymentWebhookEvent,
};
