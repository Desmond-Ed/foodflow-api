const logger = require('../utils/logger');

// Custom error class so route handlers can throw errors with a known
// HTTP status instead of always returning a generic 500.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route ${req.originalUrl} not found`));
}

// Express recognizes this as an error handler because it takes 4 arguments.
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  logger.error(`${req.method} ${req.originalUrl} -> ${err.message}`, {
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: {
      message: statusCode === 500 ? 'Internal server error' : err.message,
      status: statusCode,
    },
  });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
