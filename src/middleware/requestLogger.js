const logger = require('../utils/logger');

// Logs method, path, status code and response time for every request.
// This is the kind of visibility you need to "monitor application
// performance and help investigate system issues" in production.
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.info(
      `${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs}ms`
    );
  });

  next();
}

module.exports = requestLogger;
