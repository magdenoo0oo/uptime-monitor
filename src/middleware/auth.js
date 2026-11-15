import { unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export function requireAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  try {
    req.userId = verifyAccessToken(token).sub;
    next();
  } catch {
    next(unauthorized('Invalid or expired access token'));
  }
}
