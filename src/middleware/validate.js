import { AppError, formatZodIssues } from '../utils/errors.js';

/**
 * validate({ params, query, body }) — each one is an optional Zod schema.
 * Parsed (and coerced) values are stored on `req.valid`, because in Express 5
 * `req.query` is read-only.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        return next(
          new AppError(400, 'VALIDATION_ERROR', 'Invalid request', formatZodIssues(result.error.issues, part)),
        );
      }
      req.valid[part] = result.data;
    }
    next();
  };
}
