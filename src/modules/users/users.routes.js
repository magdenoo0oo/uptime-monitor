import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { User } from '../../models/User.js';
import { notFound } from '../../utils/errors.js';
import { serializeUser } from '../../utils/serializers.js';

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    alertsEnabled: z.boolean(),
    statusPageSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Slug: 3-40 chars, letters, numbers and dashes')
      .nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update');

export const userRoutes = Router();

userRoutes.get('/me', async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) throw notFound('User not found');
  res.json({ user: serializeUser(user) });
});

userRoutes.patch('/me', validate({ body: updateMeSchema }), async (req, res) => {
  const { statusPageSlug, ...rest } = req.valid.body;
  const update = { $set: rest };
  if (statusPageSlug === null) update.$unset = { statusPageSlug: 1 };
  else if (statusPageSlug !== undefined) update.$set.statusPageSlug = statusPageSlug;

  // A taken slug hits the unique index → 409 from the error handler.
  const user = await User.findByIdAndUpdate(req.userId, update, { returnDocument: 'after' }).lean();
  if (!user) throw notFound('User not found');
  res.json({ user: serializeUser(user) });
});
