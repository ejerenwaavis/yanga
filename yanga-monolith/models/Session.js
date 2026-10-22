import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // SHA-256 hash of random session token
  userId: { type: String, required: true, index: true },
  csrfToken: { type: String, default: null },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0, index: true }
}, { timestamps: true });

export default mongoose.models.Session || mongoose.model('Session', sessionSchema);
