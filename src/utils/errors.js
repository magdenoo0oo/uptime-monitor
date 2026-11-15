import mongoose from 'mongoose';

/**
 * An error we throw on purpose. It carries the HTTP status and a stable
 * machine-readable `code` that clients can switch on.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message = 'Conflict') => new AppError(409, 'CONFLICT', message);
export const tooManyRequests = (message = 'Too many requests') => new AppError(429, 'RATE_LIMITED', message);

export function formatZodIssues(issues, prefix) {
  return issues.map((issue) => ({
    path: [prefix, ...issue.path].filter((p) => p !== undefined).join('.'),
    message: issue.message,
  }));
}

/**
 * Turn any thrown value into `{ status, body }`. Shared by the HTTP error
 * handler and the Socket.io ack wrapper so both speak the same error format.
 */
export function normalizeError(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { code: err.code, message: err.message, details: err.details } };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, body: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, body: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, body: { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` } };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return { status: 400, body: { code: 'VALIDATION_ERROR', message: 'Invalid data', details } };
  }
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyValue ?? err.keyPattern ?? {});
    return { status: 409, body: { code: 'CONFLICT', message: `Already exists: ${fields.join(', ') || 'duplicate key'}` } };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong' }, unexpected: true };
}
