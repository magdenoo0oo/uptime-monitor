import mongoose from 'mongoose';

const monitorSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, maxlength: 2048 },
    method: { type: String, enum: ['GET', 'HEAD'], default: 'GET' },
    intervalMinutes: { type: Number, required: true, min: 1, max: 1440 },
    timeoutMs: { type: Number, required: true, min: 1000, max: 30_000 },
    acceptedStatus: {
      min: { type: Number, default: 200 },
      max: { type: Number, default: 399 },
    },
    // Optional: the page body must contain this text, otherwise it counts as down
    // (catches "200 OK" error pages).
    keyword: { type: String, default: null, maxlength: 200 },
    public: { type: Boolean, default: false },
    paused: { type: Boolean, default: false },
    // Bumped on every user edit. A check that started before an edit sees a
    // different revision when it finishes and throws its result away
    // (optimistic concurrency). A counter, not updatedAt: two writes in the
    // same millisecond would share a timestamp.
    revision: { type: Number, default: 0 },

    // Current state, updated after every check.
    status: { type: String, enum: ['pending', 'up', 'down'], default: 'pending' },
    statusChangedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastStatusCode: { type: Number, default: null },
    lastResponseTimeMs: { type: Number, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

monitorSchema.index({ owner: 1, createdAt: -1 });

export const Monitor = mongoose.model('Monitor', monitorSchema);
