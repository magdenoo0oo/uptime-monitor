import { logger } from '../config/logger.js';
import { normalizeError, notFound } from '../utils/errors.js';

export function notFoundHandler(req, _res, next) {
  next(notFound(`Route ${req.method} ${req.path} not found`));
}

// Express 5 forwards rejected promises from async handlers here automatically,
// so route handlers don't need try/catch or an asyncHandler wrapper.
export function errorHandler(err, req, res, _next) {
  const { status, body, unexpected } = normalizeError(err);
  if (unexpected) (req.log ?? logger).error({ err }, 'Unhandled error');
  res.status(status).json({ error: body });
}
