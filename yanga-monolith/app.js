import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Route & Middleware Imports
import generateRoutes from './routes/generate.js';
import authRoutes from './routes/auth.js';
import labRouter from './routes/lab.js';
import { requireRokitSSO } from './middleware/ssoAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true // Required for cross-subdomain cookies
}));
app.use(express.json());
app.use(cookieParser());

// Public Auth Routes (Login, Verify MFA, Me, Logout)
app.use('/api/auth', authRoutes);

// Protected API Routes (Requires valid Rokit SSO session)
app.use('/api/generate', requireRokitSSO, generateRoutes);

// Private Testing Lab (Protected by LAB_KEY)
app.use(labRouter);

// Static File Serving (Monolith Architecture)
// Serves the Vite output directory
app.use(express.static(path.join(__dirname, 'public_html')));

// React Router Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public_html', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Yanga Secured SSO Backend running on port ${PORT}`);
});
