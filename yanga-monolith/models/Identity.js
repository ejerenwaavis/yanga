import mongoose from 'mongoose';

const identitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  provider: { type: String, enum: ['rokit', 'google', 'facebook'], required: true },
  providerSub: { type: String, required: true },
  email: { type: String, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },
  linkedAt: { type: Date, default: Date.now }
}, { timestamps: true });

identitySchema.index({ provider: 1, providerSub: 1 }, { unique: true });

export default mongoose.models.Identity || mongoose.model('Identity', identitySchema);
