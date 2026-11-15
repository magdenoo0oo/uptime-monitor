import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false → never returned by queries unless asked for with .select('+password')
    password: { type: String, required: true, select: false },
    alertsEnabled: { type: Boolean, default: true },
    // Public status page at /api/v1/status/<slug>. Only monitors marked public appear.
    statusPageSlug: { type: String, lowercase: true, trim: true },
  },
  { timestamps: true },
);

userSchema.index({ statusPageSlug: 1 }, { unique: true, partialFilterExpression: { statusPageSlug: { $type: 'string' } } });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model('User', userSchema);
