import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** Delivery log for every notification, so you can see what was sent and what failed. */
const alertSchema = new mongoose.Schema(
  {
    monitor: { type: ObjectId, ref: 'Monitor', required: true },
    incident: { type: ObjectId, ref: 'Incident', required: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['down', 'recovered'], required: true },
    channel: { type: String, enum: ['email'], default: 'email' },
    to: { type: String, required: true },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

alertSchema.index({ incident: 1 });

export const Alert = mongoose.model('Alert', alertSchema);
