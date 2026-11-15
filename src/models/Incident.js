import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** An outage: opened when a monitor goes down, resolved when it comes back up. */
const incidentSchema = new mongoose.Schema(
  {
    monitor: { type: ObjectId, ref: 'Monitor', required: true },
    owner: { type: ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    // Why the incident closed: the site recovered, or the monitor was paused/edited.
    resolution: { type: String, enum: ['recovered', 'paused', null], default: null },
    cause: { type: String, required: true },
    statusCode: { type: Number, default: null },
    // true while the outage is ongoing. The partial unique index below makes
    // it impossible to have two open incidents for the same monitor, even if
    // two checks race.
    isOpen: { type: Boolean, default: true },
  },
  { timestamps: true },
);

incidentSchema.index({ monitor: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
incidentSchema.index({ monitor: 1, _id: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
