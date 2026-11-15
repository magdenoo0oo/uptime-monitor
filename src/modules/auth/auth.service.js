import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import { User } from '../../models/User.js';
import { conflict, unauthorized } from '../../utils/errors.js';
import { serializeUser } from '../../utils/serializers.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../utils/tokens.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function issueTokens(userId, family = crypto.randomUUID()) {
  const refreshToken = generateRefreshToken();
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(refreshToken),
    family,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
  });
  return { accessToken: signAccessToken(userId), refreshToken };
}

export async function register({ name, email, password }) {
  if (await User.exists({ email })) throw conflict('Email is already registered');
  const user = await User.create({ name, email, password });
  return { user: serializeUser(user), ...(await issueTokens(user._id)) };
}

// Compared against when the email doesn't exist, so the response time can't
// reveal which emails are registered.
let dummyHash;

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  dummyHash ??= await bcrypt.hash('dummy-password', 12);
  const valid = user ? await user.comparePassword(password) : await bcrypt.compare(password, dummyHash);
  if (!user || !valid) throw unauthorized('Wrong email or password');
  return { user: serializeUser(user), ...(await issueTokens(user._id)) };
}

/**
 * Refresh token rotation: each refresh token works once. Replaying an already
 * used one means it was stolen, so the whole session (family) is revoked.
 */
export async function refresh(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  const current = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
  );

  if (!current) {
    const stale = await RefreshToken.findOne({ tokenHash }).lean();
    if (stale?.revokedAt) {
      await RefreshToken.updateMany({ family: stale.family, revokedAt: null }, { $set: { revokedAt: now } });
    }
    throw unauthorized('Invalid or expired refresh token');
  }

  return issueTokens(current.user, current.family);
}

export async function logout(refreshToken) {
  const token = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) }).lean();
  if (!token) return;
  await RefreshToken.updateMany({ family: token.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
