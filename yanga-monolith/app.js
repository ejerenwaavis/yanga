import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

// Route & Middleware Imports
import generateRoutes from './routes/generate.js';
import authRoutes from './routes/auth.js';
import labRouter from './routes/lab.js';
import { 
  authenticateSession, 
  requireAuth, 
  requireActiveGeneration, 
  requireCsrf 
} from './middleware/sessionAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 
  'mongodb+srv://rokitonline:rOKItdatabaseaccess@cluster0.ykfdroi.mongodb.net/yanga?appName=Cluster0';

if (mongoose.connection.readyState === 0) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Yanga connected to MongoDB successfully.'))
    .catch((err) => console.error('Yanga MongoDB connection error:', err.message));
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(authenticateSession);

// Public Auth Routes (Rokit SSO, Google, Facebook, Me, Logout)
app.use('/api/auth', authRoutes);

// Protected API Routes (Requires valid session, active status & CSRF token)
app.use('/api/generate', requireAuth, requireActiveGeneration, requireCsrf, generateRoutes);

// Private Testing Lab (Protected by LAB_KEY)
app.use(labRouter);

// Static File Serving (Monolith Architecture)
app.use(express.static(path.join(__dirname, 'public_html')));

// React Router Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public_html', 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Yanga Secured SSO Backend running on port ${PORT}`);
  });
}

export default app;
