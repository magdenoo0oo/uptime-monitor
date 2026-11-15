import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import * as auth from './auth.service.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Invalid email'));

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

// Slows down password guessing. Disabled in tests, which register many users.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } }),
});

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  res.status(201).json(await auth.register(req.valid.body));
});

authRoutes.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  res.json(await auth.login(req.valid.body));
});

authRoutes.post('/refresh', validate({ body: refreshSchema }), async (req, res) => {
  res.json(await auth.refresh(req.valid.body.refreshToken));
});

authRoutes.post('/logout', validate({ body: refreshSchema }), async (req, res) => {
  await auth.logout(req.valid.body.refreshToken);
  res.status(204).end();
});
