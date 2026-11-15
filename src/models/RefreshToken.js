import mongoose from 'mongoose';

/**
 * One row per issued refresh token. Every refresh rotates the token: the old
 * row is revoked and a new one is created in the same `family` (one family =
 * one login session / device). If a revoked token is ever used again, someone
 * copied it, so the whole family is revoked.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// TTL index: MongoDB deletes expired tokens on its own.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
