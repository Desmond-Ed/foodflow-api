const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

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

  app.use(helmet());
  app.use(cors());

  // Paystack's webhook signature is an HMAC over the *raw* request bytes.
  // If the global JSON parser ran first, it would re-serialize the body and
  // the signature would never match. So this route gets its own raw-body
  // middleware, scoped only to itself, ahead of the global express.json()
  // below. express.raw() marks the body as already parsed, so the global
  // json() middleware correctly skips re-parsing it afterwards.
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

  // Basic abuse protection: 100 requests per minute per IP.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

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
