const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { generalLimiter, webhookLimiter } = require('./middleware/rateLimiters');
const { resolveTrustProxy } = require('./config/trustProxy');
const requestLogger = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const vendorRoutes = require('./routes/vendors');
const orderRoutes = require('./routes/orders');
const healthRoutes = require('./routes/health');
const addressRoutes = require('./routes/addresses');
const deliveryRoutes = require('./routes/delivery');
const paymentRoutes = require('./routes/payments');

function createApp() {
  const app = express();

  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY));

  app.use(helmet());
  app.use(cors());

  // Paystack's webhook signature is an HMAC over the *raw* request bytes.
  // If the global JSON parser ran first, it would re-serialize the body and
  // the signature would never match. So this route gets its own raw-body
  // middleware, scoped only to itself, ahead of the global express.json()
  // below. express.raw() marks the body as already parsed, so the global
  // json() middleware correctly skips re-parsing it afterwards.
  // The webhook has its own (more generous) budget so Paystack retries can
  // never be blocked by the general per-IP limit. It must still run before
  // the raw-body parser to preserve signature verification.
  app.use('/api/payments/webhook', webhookLimiter);

  app.use(
    '/api/payments/webhook',
    express.raw({ type: '*/*' }),
    (req, res, next) => {
      req.rawBody = req.body;
      try {
        req.body = req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
      } catch (err) {
        req.body = {};
      }
      next();
    }
  );

  app.use(express.json());
  app.use(requestLogger);

  // Basic abuse protection: 100 requests per minute per IP, excluding the
  // Paystack webhook which is limited separately above.
  app.use(generalLimiter);

  app.use('/api/health', healthRoutes);
  app.use('/api/vendors', vendorRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/addresses', addressRoutes);
  app.use('/api/delivery', deliveryRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
