import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // Canonical UUID v4
  status: { 
    type: String, 
    enum: ['active', 'restricted', 'suspended', 'banned'], 
    default: 'active',
    index: true
  },
  email: { type: String, required: true, lowercase: true, trim: true },
  emailNormalized: { type: String, required: true, index: true },
  emailVerified: { type: Boolean, default: false },
  name: { type: String, default: '' },
  avatarUrl: { type: String, default: null },
  country: { type: String, default: null },
  roles: { type: [String], default: ['customer'] },
  strikes: { type: Number, default: 0 },
  freeExtensionUsed: { type: Boolean, default: false },
  acceptedDocs: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastLoginAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', userSchema);
