const express = require('express');
const crypto = require('crypto');
const { initializeTransaction, verifyWebhookSignature } = require('../services/paystackService');
const {
  createPayment,
  getPaymentByOrderId,
  processPaymentWebhookEvent,
} = require('../models/paymentModel');
const { getOrderById } = require('../models/orderModel');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/payments/initialize
// Body: { orderId, email } -> Paystack checkout URL
router.post('/initialize', async (req, res, next) => {
  try {
    const { orderId, email } = req.body || {};

    if (!Number.isInteger(orderId) || orderId < 1) {
      throw new ApiError(400, 'orderId must be a positive integer');
    }

    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
      throw new ApiError(400, 'a valid email is required');
    }

    const order = await getOrderById(orderId);
    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    if (order.status !== 'pending') {
      throw new ApiError(409, 'Order is not awaiting payment');
    }

    const existingPayment = await getPaymentByOrderId(orderId);
    if (existingPayment) {
      if (existingPayment.status === 'pending') {
        throw new ApiError(409, 'A payment is already pending for this order');
      }
      if (existingPayment.status === 'success') {
        throw new ApiError(409, 'Order has already been paid');
      }
    }

    const reference = `foodflow_${order.id}_${crypto.randomBytes(6).toString('hex')}`;

    const transaction = await initializeTransaction({
      email,
      amountNaira: Number(order.total_naira),
      reference,
      metadata: { orderId: order.id },
    });

    await createPayment({
      orderId: order.id,
      reference: transaction.reference,
      amountNaira: Number(order.total_naira),
    });

    res.status(201).json({
      data: {
        authorizationUrl: transaction.authorizationUrl,
        reference: transaction.reference,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Placeholder for genuinely non-critical follow-up work - e.g. pinging the
// vendor's dashboard. Safe to run after the webhook has been acknowledged,
// since losing it isn't a correctness problem the way losing the payment
// confirmation itself would be.
async function notifyVendorOfPayment(orderId) {
  logger.info(`(stub) would notify vendor that order ${orderId} is paid`);
}

// POST /api/payments/webhook
// Called by Paystack. Verifies the signature against the raw request body
// (captured by the route-scoped raw-body middleware in app.js), then
// dedupes by event id and durably updates payment/order status *before*
// acknowledging - that write is the whole point of the webhook, so it must
// complete first, or a crash right after a 2xx would silently lose a
// payment confirmation Paystack would otherwise have retried. Only the
// genuinely non-critical follow-up (e.g. notifying the vendor) happens
// after the response goes out.
router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody;

    if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
      throw new ApiError(401, 'Invalid webhook signature');
    }

    const event = req.body;
    const eventId = event?.data?.id ? String(event.data.id) : event?.id;
    const eventType = event?.event;
    const reference = event?.data?.reference;

    if (!eventId || !eventType || !reference) {
      throw new ApiError(400, 'Malformed webhook payload');
    }

    const succeeded = eventType === 'charge.success';
    const result = await processPaymentWebhookEvent({ eventId, eventType, reference, succeeded });

    res.status(200).json({ received: true });

    if (!result.alreadyProcessed) {
      logger.info(`payment webhook processed: order ${result.orderId} -> ${result.paymentStatus}`);
      notifyVendorOfPayment(result.orderId).catch((err) =>
        logger.error(`vendor notification failed: ${err.message}`)
      );
    } else {
      logger.info(`duplicate webhook event ignored: ${eventId}`);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/:orderId/status
router.get('/:orderId/status', async (req, res, next) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId)) {
      throw new ApiError(400, 'orderId must be a number');
    }

    const payment = await getPaymentByOrderId(orderId);
    if (!payment) {
      throw new ApiError(404, 'No payment found for this order');
    }

    res.json({
      data: {
        orderId: payment.order_id,
        reference: payment.paystack_reference,
        status: payment.status,
        amount_naira: Number(payment.amount_naira),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
