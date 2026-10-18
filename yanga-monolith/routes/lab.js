import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fal } from '@fal-ai/client';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage directories outside public_html
const LAB_DATA_DIR = process.env.LAB_DATA_DIR || path.join(__dirname, '..', 'lab-data');
const RESULTS_DIR = path.join(LAB_DATA_DIR, 'results');
const ORIGINAL_PHOTO_PATH = path.join(LAB_DATA_DIR, 'original.jpg');
const STATE_FILE_PATH = path.join(LAB_DATA_DIR, 'state.json');

// Ensure directories exist
if (!fs.existsSync(LAB_DATA_DIR)) {
  fs.mkdirSync(LAB_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// Multer memory storage for original photo uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();

/**
 * Read or initialize state.json
 */
function readLabState() {
  const defaultState = {
    scene: 'in a sleek modern high-rise executive corner office, sitting by floor-to-ceiling panoramic glass windows overlooking city skyline, wearing an impeccably tailored bespoke business suit, clean modern architectural interior, crisp natural window light, commanding executive confidence',
    seed: 42,
    lastConfig: {
      model: 'fal-ai/flux-pulid',
      input: {
        prompt: 'Waist-up portrait of a woman in an executive corner office, natural daylight, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering',
        id_weight: 0.85,
        start_step: 2,
        guidance_scale: 2.8,
        true_cfg: 1.0,
        num_inference_steps: 35,
        seed: 42,
        image_size: { width: 1080, height: 1350 },
        max_sequence_length: '256'
      }
    }
  };

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf8'));
      return { ...defaultState, ...data };
    }
  } catch (err) {
    console.warn('[LAB] Could not parse state.json, using defaults:', err.message);
  }
  return defaultState;
}

/**
 * Save state.json
 */
function saveLabState(updates) {
  try {
    const current = readLabState();
    const updated = { ...current, ...updates };
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error('[LAB] Error saving state.json:', err);
    return null;
  }
}

/**
 * Upload buffer or file to Fal Storage with fallback to Base64 data URI
 */
async function uploadToFalStorage(buffer, mimeType = 'image/jpeg') {
  try {
    if (fal.storage && typeof fal.storage.upload === 'function') {
      const blob = new Blob([buffer], { type: mimeType });
      const url = await fal.storage.upload(blob);
      if (url) {
        console.log('[LAB] Photo uploaded to Fal storage:', url);
        return url;
      }
    }
  } catch (err) {
    console.warn('[LAB] fal.storage.upload fallback to data URI:', err.message);
  }
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Apply Gaussian film grain (sigma ~2) via sharp
 */
async function applySharpFilmGrain(imageBuffer, sigma = 2.0) {
  try {
    const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true });
    
    // Box-Muller transform for Gaussian noise
    function gaussianNoise(sig) {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sig;
    }

    const channels = info.channels;
    for (let i = 0; i < data.length; i += channels) {
      const noise = gaussianNoise(sigma);
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }

    return await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels
      }
    }).jpeg({ quality: 95 }).toBuffer();
  } catch (grainErr) {
    console.warn('[LAB] Film grain post-processing fallback:', grainErr.message);
    return imageBuffer;
  }
}

/**
 * Access Control Middleware
 * Protects everything with process.env.LAB_KEY
 */
export function labAuthMiddleware(req, res, next) {
  const configuredKey = (process.env.LAB_KEY || '').trim();
  if (!configuredKey) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="robots" content="noindex, nofollow">
        <title>Lab Error 500</title>
        <style>body{background:#0a0a0a;color:#eee;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
        .card{background:#171717;border:1px solid #dc2626;padding:2rem;border-radius:12px;max-width:480px;}</style>
      </head>
      <body>
        <div class="card">
          <h2 style="color:#ef4444;margin-top:0;">500 — LAB_KEY Missing</h2>
          <p>The testing lab is locked because <code>LAB_KEY</code> is not configured in the server environment variables.</p>
          <p style="color:#a3a3a3;font-size:12px;">Add <code>LAB_KEY=&lt;secret&gt;</code> to your .env or cPanel Node.js Application Manager variables.</p>
        </div>
      </body>
      </html>
    `);
  }

  const providedKey = (
    req.query.key ||
    req.headers['x-lab-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.cookies?.yanga_lab_key ||
    ''
  ).trim();

  if (providedKey === configuredKey) {
    return next();
  }

  // If API route, return 401 JSON
  if (req.path.startsWith('/api/') || req.originalUrl.includes('/api/lab')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing LAB_KEY.' });
  }

  // If HTML page visit without valid key, render prompt
  return res.status(401).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="robots" content="noindex, nofollow">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Yanga Studio — Lab Authentication</title>
      <style>
        body { background: #09090b; color: #fafafa; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
        .box { background: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 1rem; width: 100%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        h1 { font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem; }
        p { color: #a1a1aa; font-size: 0.85rem; margin: 0 0 1.25rem; }
        input { width: 100%; box-sizing: border-box; background: #09090b; border: 1px solid #3f3f46; color: #fff; padding: 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; margin-bottom: 1rem; outline: none; }
        input:focus { border-color: #f59e0b; }
        button { width: 100%; background: #f59e0b; color: #09090b; font-weight: 700; border: none; padding: 0.75rem; border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer; }
        button:hover { background: #d97706; }
        .err { background: #450a0a; color: #fca5a5; padding: 0.5rem; border-radius: 0.5rem; font-size: 0.75rem; margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>🔒 Private Testing Lab</h1>
        <p>Enter your <code>LAB_KEY</code> to unlock the test environment.</p>
        ${providedKey ? '<div class="err">Invalid LAB_KEY provided. Please check and try again.</div>' : ''}
        <form onsubmit="event.preventDefault(); const k = document.getElementById('keyInput').value.trim(); if(k){ localStorage.setItem('yanga_lab_key', k); window.location.href = '/lab?key=' + encodeURIComponent(k); }">
          <input type="password" id="keyInput" placeholder="Enter LAB_KEY..." required autofocus />
          <button type="submit">Unlock Testing Lab</button>
        </form>
      </div>
    </body>
    </html>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML VIEW ROUTE: /lab
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lab', labAuthMiddleware, (req, res) => {
  const labKey = (process.env.LAB_KEY || '').trim();
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yanga Studio — Realism Testing Lab</title>
  <style>
    :root {
      --bg: #09090b;
      --card-bg: #141417;
      --card-border: #27272a;
      --amber: #f59e0b;
      --amber-hover: #d97706;
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.5; padding: 1rem; min-height: 100vh; }
    .container { max-width: 1024px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    
    /* Top Bar */
    .topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; font-size: 0.8rem; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); color: var(--amber); font-weight: 600; font-size: 0.75rem; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }

    /* Cards */
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
    .card-title { font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #e4e4e7; display: flex; align-items: center; gap: 8px; }
    .card-title span.num { width: 22px; height: 22px; border-radius: 50%; background: var(--amber); color: #000; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; }

    /* Upload Area */
    .upload-container { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
    .thumb-wrap { width: 140px; height: 180px; border-radius: 10px; overflow: hidden; border: 2px solid var(--amber); position: relative; background: #000; }
    .thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
    .upload-btn-label { display: inline-block; background: #27272a; hover: #3f3f46; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: 1px solid #3f3f46; transition: background 0.15s; }
    .upload-btn-label:hover { background: #3f3f46; }

    /* Inputs */
    label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px; }
    textarea, input[type="text"], input[type="number"] { width: 100%; background: #09090b; border: 1px solid var(--card-border); border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.85rem; font-family: inherit; outline: none; }
    textarea:focus, input:focus { border-color: var(--amber); }
    textarea { min-height: 80px; resize: vertical; }

    /* Preset Grid */
    .presets-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem; }
    .preset-btn { background: #1c1c21; border: 1px solid #2e2e36; border-radius: 10px; padding: 1rem; text-align: left; cursor: pointer; transition: all 0.15s; display: flex; flex-direction: column; justify-content: space-between; min-height: 120px; }
    .preset-btn:hover:not(:disabled) { border-color: var(--amber); background: #24242b; transform: translateY(-1px); }
    .preset-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .p-tag { font-size: 0.7rem; font-weight: 800; color: var(--amber); text-transform: uppercase; margin-bottom: 4px; }
    .p-title { font-size: 0.85rem; font-weight: 700; color: #fff; line-height: 1.3; margin-bottom: 6px; }
    .p-desc { font-size: 0.72rem; color: var(--text-muted); line-height: 1.4; }

    /* Run All Button */
    .btn-run-all { background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-weight: 800; font-size: 0.9rem; padding: 0.85rem 1.25rem; border: none; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: opacity 0.15s; box-shadow: 0 4px 14px rgba(245,158,11,0.25); }
    .btn-run-all:hover:not(:disabled) { opacity: 0.9; }
    .btn-run-all:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Custom JSON card */
    .code-box { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; background: #000; color: #a5f3fc; border: 1px solid #222; }

    /* Results Gallery */
    .results-gallery { display: flex; flex-direction: column; gap: 1.5rem; }
    .result-card { background: #141417; border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
    .res-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid #222; padding-bottom: 0.75rem; }
    .res-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
    .res-badge { padding: 2px 8px; border-radius: 6px; background: rgba(245,158,11,0.15); color: var(--amber); font-weight: 700; font-size: 0.72rem; }
    .res-model { padding: 2px 8px; border-radius: 6px; background: #27272a; color: #d4d4d8; font-mono; font-size: 0.7rem; }
    .res-runtime { color: #10b981; font-weight: 600; }
    .res-actions { display: flex; gap: 8px; }
    .res-btn { background: #27272a; border: 1px solid #3f3f46; color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; text-decoration: none; }
    .res-btn.delete { color: #f87171; border-color: rgba(239,68,68,0.3); }
    .res-btn.delete:hover { background: rgba(239,68,68,0.15); }

    /* Side by Side Image Container */
    .compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 640px) { .compare-grid { grid-template-columns: 1fr; } }
    .comp-col { display: flex; flex-direction: column; gap: 6px; }
    .comp-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); }
    .comp-img { width: 100%; max-height: 440px; object-fit: contain; border-radius: 10px; background: #000; border: 1px solid #27272a; }

    /* Progress Overlay */
    .progress-bar { background: #27272a; border-radius: 6px; overflow: hidden; height: 8px; width: 100%; margin-top: 6px; display: none; }
    .progress-fill { background: var(--amber); height: 100%; width: 0%; transition: width 0.3s; }
    .alert-err { background: #450a0a; border: 1px solid #ef4444; color: #fca5a5; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.8rem; display: none; }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Top Bar -->
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="status-dot"></span>
        <span style="font-weight:700;">Yanga Studio Lab</span>
        <span class="badge">Experimental Baseline Engine</span>
      </div>
      <div>
        <span style="color:var(--text-muted);font-size:0.75rem;">Key Active ✓</span>
      </div>
    </div>

    <!-- Alert Box -->
    <div id="errorAlert" class="alert-err"></div>

    <!-- STEP 1: Upload Card -->
    <div class="card">
      <div class="card-title">
        <span class="num">1</span>
        <span>Reference Test Photo (Uploaded Once, Persists Across Sessions)</span>
      </div>
      <div class="upload-container">
        <div id="thumbContainer" class="thumb-wrap" style="display:none;">
          <img id="originalThumb" src="" alt="Test Reference Photo">
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label class="upload-btn-label">
            <span id="uploadLabelText">📸 Upload Test Photo</span>
            <input type="file" id="photoInput" accept="image/*" style="display:none;" onchange="handlePhotoUpload(this.files[0])">
          </label>
          <span style="font-size:0.75rem;color:var(--text-muted);" id="photoStatusText">Loading saved reference photo...</span>
        </div>
      </div>
    </div>

    <!-- STEP 2: Scene & Seed -->
    <div class="card">
      <div class="card-title">
        <span class="num">2</span>
        <span>Scene Prompt & Seed Calibration</span>
      </div>
      <div>
        <label>Scene Description (appended or used in background transformation)</label>
        <textarea id="sceneInput" placeholder="Describe the scene environment, lighting, and interior..."></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 140px;gap:12px;align-items:end;">
        <div>
          <label>Seed (Locks latent noise for identical seed comparisons)</label>
          <input type="number" id="seedInput" value="42">
        </div>
        <button type="button" class="upload-btn-label" style="text-align:center;padding:10px;" onclick="document.getElementById('seedInput').value = Math.floor(Math.random() * 9999999); saveCurrentState();">
          🎲 Randomize
        </button>
      </div>
    </div>

    <!-- STEP 3: Presets & Run All -->
    <div class="card">
      <div class="card-title">
        <span class="num">3</span>
        <span>A/B/C/D Baseline Presets</span>
      </div>
      
      <div class="presets-grid">
        <!-- Preset A -->
        <button type="button" class="preset-btn" id="btnPresetA" onclick="runPreset('A')">
          <div>
            <div class="p-tag">Preset A</div>
            <div class="p-title">FLUX.1 Kontext [pro]</div>
            <div class="p-desc">In-context background replacement. Locks exact face, hair, outfit, pose and expression.</div>
          </div>
          <div style="font-size:0.72rem;color:var(--amber);margin-top:8px;">fal-ai/flux-pro/kontext ↗</div>
        </button>

        <!-- Preset B -->
        <button type="button" class="preset-btn" id="btnPresetB" onclick="runPreset('B')">
          <div>
            <div class="p-tag">Preset B</div>
            <div class="p-title">PuLID Baseline 0.9</div>
            <div class="p-desc">id_weight 0.9, CFG 1.2, guidance 2.8, start_step 1, 35 steps.</div>
          </div>
          <div style="font-size:0.72rem;color:var(--amber);margin-top:8px;">fal-ai/flux-pulid ↗</div>
        </button>

        <!-- Preset C -->
        <button type="button" class="preset-btn" id="btnPresetC" onclick="runPreset('C')">
          <div>
            <div class="p-tag">Preset C</div>
            <div class="p-title">PuLID Natural 0.8</div>
            <div class="p-desc">id_weight 0.8, CFG 1.0 (pure flow), guidance 2.5, start_step 2, 40 steps.</div>
          </div>
          <div style="font-size:0.72rem;color:var(--amber);margin-top:8px;">fal-ai/flux-pulid ↗</div>
        </button>

        <!-- Preset D -->
        <button type="button" class="preset-btn" id="btnPresetD" onclick="runPreset('D')">
          <div>
            <div class="p-tag">Preset D</div>
            <div class="p-title">Kontext + Upscale + Grain</div>
            <div class="p-desc">Preset A output &rarr; Clarity Upscaler (creativity 0.2) &rarr; Film Grain (&sigma;&approx;2).</div>
          </div>
          <div style="font-size:0.72rem;color:var(--amber);margin-top:8px;">Multi-Stage Pipeline ↗</div>
        </button>
      </div>

      <!-- Run All Button & Progress Bar -->
      <button type="button" class="btn-run-all" id="btnRunAll" onclick="runAllSequential()">
        <span>⚡ Run All Baseline Tests (Sequential A &rarr; B &rarr; C &rarr; D)</span>
      </button>
      <div id="runProgressText" style="font-size:0.78rem;color:var(--amber);font-weight:600;display:none;"></div>
      <div id="progressBar" class="progress-bar">
        <div id="progressFill" class="progress-fill"></div>
      </div>
    </div>

    <!-- STEP 4: Custom Run Editor -->
    <div class="card">
      <div class="card-title">
        <span class="num">4</span>
        <span>Custom Configuration Sandbox (Single Parameter Tweaks)</span>
      </div>
      <div>
        <label>Editable JSON Configuration (Prefilled with last run)</label>
        <textarea id="customJsonInput" class="code-box" style="min-height:160px;"></textarea>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;gap:6px;">
          <button type="button" class="res-btn" onclick="populateCustomPreset('A')">Load A</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('B')">Load B</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('C')">Load C</button>
        </div>
        <button type="button" class="upload-btn-label" id="btnRunCustom" style="background:var(--amber);color:#000;border:none;font-weight:700;" onclick="runCustom()">
          ▶ Run Custom Config
        </button>
      </div>
    </div>

    <!-- STEP 5: Results Gallery -->
    <div class="card">
      <div class="card-title" style="justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="num">5</span>
          <span>Results & Side-by-Side Comparison Gallery</span>
        </div>
        <span id="resultsCount" style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;">0 runs</span>
      </div>
      <div id="resultsGallery" class="results-gallery">
        <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">
          No test runs completed yet. Upload a photo and pick a preset above!
        </div>
      </div>
    </div>

  </div>

  <script>
    // Retrieve and persist lab key
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('key');
    if (keyFromUrl) {
      localStorage.setItem('yanga_lab_key', keyFromUrl);
    }
    const LAB_KEY = localStorage.getItem('yanga_lab_key') || '${labKey}';

    // Helper for authenticated requests
    async function labFetch(url, options = {}) {
      options.headers = options.headers || {};
      options.headers['x-lab-key'] = LAB_KEY;
      options.credentials = 'include';
      const sep = url.includes('?') ? '&' : '?';
      return fetch(url + sep + 'key=' + encodeURIComponent(LAB_KEY), options);
    }

    function showError(msg) {
      const el = document.getElementById('errorAlert');
      if (!msg) {
        el.style.display = 'none';
        el.textContent = '';
      } else {
        el.style.display = 'block';
        el.textContent = '⚠️ ' + msg;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    // Load initial state
    async function loadLabState() {
      try {
        const res = await labFetch('/api/lab/state');
        const data = await res.json();
        if (data.success) {
          if (data.hasOriginal) {
            document.getElementById('thumbContainer').style.display = 'block';
            document.getElementById('originalThumb').src = '/api/lab/original?key=' + encodeURIComponent(LAB_KEY) + '&t=' + Date.now();
            document.getElementById('uploadLabelText').textContent = '🔄 Replace Photo';
            document.getElementById('photoStatusText').textContent = 'Reference photo loaded and locked.';
          } else {
            document.getElementById('thumbContainer').style.display = 'none';
            document.getElementById('uploadLabelText').textContent = '📸 Upload Test Photo';
            document.getElementById('photoStatusText').textContent = 'Please upload a reference photo.';
          }

          if (data.state) {
            document.getElementById('sceneInput').value = data.state.scene || '';
            document.getElementById('seedInput').value = data.state.seed ?? 42;
            if (data.state.lastConfig) {
              document.getElementById('customJsonInput').value = JSON.stringify(data.state.lastConfig, null, 2);
            }
          }
        }
      } catch (err) {
        showError('Could not load lab state: ' + err.message);
      }
    }

    // Save scene & seed state
    async function saveCurrentState() {
      const scene = document.getElementById('sceneInput').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;
      try {
        await labFetch('/api/lab/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scene, seed })
        });
      } catch (err) {
        console.warn('Could not save state:', err);
      }
    }
    document.getElementById('sceneInput').addEventListener('blur', saveCurrentState);
    document.getElementById('seedInput').addEventListener('blur', saveCurrentState);

    // Upload Photo
    async function handlePhotoUpload(file) {
      if (!file) return;
      showError(null);
      document.getElementById('photoStatusText').textContent = 'Uploading test photo...';
      const fd = new FormData();
      fd.append('photo', file);

      try {
        const res = await labFetch('/api/lab/upload', {
          method: 'POST',
          body: fd
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('thumbContainer').style.display = 'block';
          document.getElementById('originalThumb').src = '/api/lab/original?key=' + encodeURIComponent(LAB_KEY) + '&t=' + Date.now();
          document.getElementById('uploadLabelText').textContent = '🔄 Replace Photo';
          document.getElementById('photoStatusText').textContent = 'Photo saved persistently ✓';
        } else {
          showError(data.error || 'Upload failed.');
        }
      } catch (err) {
        showError('Upload failed: ' + err.message);
      }
    }

    // Load Results
    async function loadResults() {
      try {
        const res = await labFetch('/api/lab/results');
        const data = await res.json();
        if (data.success && Array.isArray(data.results)) {
          renderResults(data.results);
        }
      } catch (err) {
        console.warn('Failed to load results:', err);
      }
    }

    function renderResults(results) {
      const countEl = document.getElementById('resultsCount');
      const gallery = document.getElementById('resultsGallery');
      countEl.textContent = results.length + ' run' + (results.length === 1 ? '' : 's');

      if (!results.length) {
        gallery.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">No test runs yet. Run a preset above!</div>';
        return;
      }

      gallery.innerHTML = results.map(r => {
        const origUrl = '/api/lab/original?key=' + encodeURIComponent(LAB_KEY);
        const genUrl = r.imageUrl ? (r.imageUrl.startsWith('http') ? r.imageUrl : r.imageUrl + '?key=' + encodeURIComponent(LAB_KEY)) : r.remoteUrl;
        const jsonStr = JSON.stringify(r.params || {}, null, 2);

        return \`
          <div class="result-card" id="card-\${r.id}">
            <div class="res-header">
              <div class="res-meta">
                <span class="res-badge">\${r.presetLabel || r.preset || 'Run'}</span>
                <span class="res-model">\${r.model}</span>
                <span>Seed: <strong>\${r.seed ?? 'N/A'}</strong></span>
                <span class="res-runtime">⚡ \${r.runtime || 'N/A'}</span>
                <span style="color:var(--text-muted);">\${new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
              </div>
              <div class="res-actions">
                <a href="\${genUrl}" download="\${r.id}.jpg" target="_blank" class="res-btn">⬇ Download</a>
                <button type="button" class="res-btn delete" onclick="deleteRun('\${r.id}')">🗑 Delete</button>
              </div>
            </div>

            <!-- Side by Side Comparison -->
            <div class="compare-grid">
              <div class="comp-col">
                <span class="comp-label">Original Reference</span>
                <img src="\${origUrl}" class="comp-img" alt="Original Reference" />
              </div>
              <div class="comp-col">
                <span class="comp-label">Generated Result (\${r.preset || 'Output'})</span>
                <img src="\${genUrl}" class="comp-img" alt="Generated Result" onclick="window.open('\${genUrl}', '_blank')" style="cursor:zoom-in;" />
              </div>
            </div>

            <!-- Parameters Accordion -->
            <details style="font-size:0.75rem;margin-top:4px;">
              <summary style="cursor:pointer;color:var(--amber);font-weight:600;">Show Full Parameters JSON</summary>
              <pre class="code-box" style="padding:0.75rem;border-radius:8px;margin-top:6px;overflow-x:auto;">\${jsonStr}</pre>
            </details>
          </div>
        \`;
      }).join('');
    }

    async function deleteRun(id) {
      if (!confirm('Delete this test run?')) return;
      try {
        const res = await labFetch('/api/lab/results/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          const card = document.getElementById('card-' + id);
          if (card) card.remove();
          loadResults();
        } else {
          alert('Delete failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    }

    // Running Presets
    async function executeRun(preset, customConfig = null) {
      showError(null);
      const scene = document.getElementById('sceneInput').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;

      const res = await labFetch('/api/lab/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, scene, seed, customConfig })
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Generation failed.');
      }
      return data.result;
    }

    function setButtonsDisabled(disabled) {
      document.querySelectorAll('.preset-btn, #btnRunAll, #btnRunCustom').forEach(b => b.disabled = disabled);
    }

    async function runPreset(preset) {
      setButtonsDisabled(true);
      showError(null);
      const btn = document.getElementById('btnPreset' + preset);
      const oldText = btn.innerHTML;
      btn.innerHTML = '<div><div class="p-tag">RUNNING...</div><div class="p-title">Processing Fal API</div><div class="p-desc">Please wait...</div></div>';

      try {
        const result = await executeRun(preset);
        loadResults();
        if (result && result.params) {
          document.getElementById('customJsonInput').value = JSON.stringify({ model: result.model, input: result.params }, null, 2);
        }
      } catch (err) {
        showError('Preset ' + preset + ' Error: ' + err.message);
      } finally {
        btn.innerHTML = oldText;
        setButtonsDisabled(false);
      }
    }

    async function runCustom() {
      setButtonsDisabled(true);
      showError(null);
      const btn = document.getElementById('btnRunCustom');
      btn.textContent = '⏳ Executing...';

      try {
        const rawJson = document.getElementById('customJsonInput').value;
        const parsed = JSON.parse(rawJson);
        const result = await executeRun('custom', parsed);
        loadResults();
      } catch (err) {
        showError('Custom Run Error: ' + err.message);
      } finally {
        btn.textContent = '▶ Run Custom Config';
        setButtonsDisabled(false);
      }
    }

    async function runAllSequential() {
      setButtonsDisabled(true);
      showError(null);
      const progressText = document.getElementById('runProgressText');
      const progressBar = document.getElementById('progressBar');
      const progressFill = document.getElementById('progressFill');

      progressText.style.display = 'block';
      progressBar.style.display = 'block';

      const queue = [
        { id: 'A', name: 'Preset A (Flux-Pro Kontext)' },
        { id: 'B', name: 'Preset B (PuLID 0.9)' },
        { id: 'C', name: 'Preset C (PuLID 0.8)' },
        { id: 'D', name: 'Preset D (Kontext + Upscale + Grain)' }
      ];

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        const pct = Math.round((i / queue.length) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = \`Running [\${i + 1}/\${queue.length}]: \${item.name}...\`;

        try {
          await executeRun(item.id);
          await loadResults();
        } catch (err) {
          showError(\`Failed on \${item.name}: \${err.message}. Continuing queue...\`);
        }
      }

      progressFill.style.width = '100%';
      progressText.textContent = '✅ All 4 baseline tests completed!';
      setTimeout(() => {
        progressText.style.display = 'none';
        progressBar.style.display = 'none';
        progressFill.style.width = '0%';
      }, 5000);

      setButtonsDisabled(false);
    }

    function populateCustomPreset(preset) {
      const scene = document.getElementById('sceneInput').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;
      let cfg = {};

      if (preset === 'A') {
        cfg = {
          model: 'fal-ai/flux-pro/kontext',
          input: {
            prompt: 'Change only the background to ' + scene + '. Keep the person\\'s face, hair, outfit, pose and expression exactly identical. Natural unretouched photo, realistic skin texture.',
            seed: seed
          }
        };
      } else if (preset === 'B') {
        cfg = {
          model: 'fal-ai/flux-pulid',
          input: {
            prompt: scene + ', Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details',
            id_weight: 0.9,
            guidance_scale: 2.8,
            start_step: 1,
            true_cfg: 1.2,
            num_inference_steps: 35,
            seed: seed,
            max_sequence_length: '256'
          }
        };
      } else if (preset === 'C') {
        cfg = {
          model: 'fal-ai/flux-pulid',
          input: {
            prompt: scene + ', Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details',
            id_weight: 0.8,
            guidance_scale: 2.5,
            start_step: 2,
            true_cfg: 1.0,
            num_inference_steps: 40,
            seed: seed,
            max_sequence_length: '256'
          }
        };
      }
      document.getElementById('customJsonInput').value = JSON.stringify(cfg, null, 2);
    }

    // Init on page load
    loadLabState();
    loadResults();
  </script>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES: /api/lab/*
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/lab/state
 */
router.get('/api/lab/state', labAuthMiddleware, (req, res) => {
  try {
    const hasOriginal = fs.existsSync(ORIGINAL_PHOTO_PATH);
    const state = readLabState();
    res.json({ success: true, hasOriginal, state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/state
 */
router.post('/api/lab/state', labAuthMiddleware, (req, res) => {
  try {
    const { scene, seed, lastConfig } = req.body;
    const updated = saveLabState({ scene, seed, lastConfig });
    res.json({ success: true, state: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/upload
 * Upload and save original.jpg
 */
router.post('/api/lab/upload', labAuthMiddleware, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No photo provided in upload.' });
    }
    fs.writeFileSync(ORIGINAL_PHOTO_PATH, req.file.buffer);
    console.log('[LAB] Saved new original test photo to', ORIGINAL_PHOTO_PATH);
    res.json({ success: true, hasOriginal: true });
  } catch (err) {
    console.error('[LAB] Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lab/original
 * Stream saved original.jpg
 */
router.get('/api/lab/original', labAuthMiddleware, (req, res) => {
  try {
    if (!fs.existsSync(ORIGINAL_PHOTO_PATH)) {
      return res.status(404).json({ success: false, error: 'No original photo found.' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const readStream = fs.createReadStream(ORIGINAL_PHOTO_PATH);
    readStream.pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lab/results
 * Returns saved runs sorted newest first
 */
router.get('/api/lab/results', labAuthMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    const results = files.map(file => {
      try {
        const content = fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    }).filter(Boolean);

    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lab/results/:filename
 * Serve locally saved generated image
 */
router.get('/api/lab/results/:filename', labAuthMiddleware, (req, res) => {
  try {
    const filePath = path.join(RESULTS_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * DELETE /api/lab/results/:id
 */
router.delete('/api/lab/results/:id', labAuthMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const jsonPath = path.join(RESULTS_DIR, `${id}.json`);
    const imgJpg = path.join(RESULTS_DIR, `${id}.jpg`);
    const imgPng = path.join(RESULTS_DIR, `${id}.png`);

    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    if (fs.existsSync(imgJpg)) fs.unlinkSync(imgJpg);
    if (fs.existsSync(imgPng)) fs.unlinkSync(imgPng);

    console.log('[LAB] Deleted run:', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/run
 * Execute preset or custom configuration against the persistent original.jpg
 */
router.post('/api/lab/run', labAuthMiddleware, async (req, res) => {
  const startTime = Date.now();
  const { preset, scene, seed, customConfig } = req.body;
  const numSeed = parseInt(seed, 10) || 42;

  console.log(`[LAB RUN START] Preset: ${preset}, Seed: ${numSeed}, Time: ${new Date().toISOString()}`);

  if (!fs.existsSync(ORIGINAL_PHOTO_PATH)) {
    return res.status(400).json({
      success: false,
      error: 'Please upload a reference photo in Step 1 first.'
    });
  }

  // 1. Verify and configure FAL API key
  const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!falKey || falKey === 'your_fal_api_key_here') {
    return res.status(500).json({
      success: false,
      error: 'FAL_KEY is not configured in .env. Please check your credentials.'
    });
  }
  fal.config({ credentials: falKey });

  try {
    // 2. Upload test photo to Fal Storage (or base64 fallback)
    const photoBuffer = fs.readFileSync(ORIGINAL_PHOTO_PATH);
    const photoUrl = await uploadToFalStorage(photoBuffer, 'image/jpeg');

    let modelId = '';
    let modelInput = {};
    let presetLabel = '';
    let isPipelineD = false;

    if (preset === 'A') {
      presetLabel = 'Preset A (Flux-Pro Kontext)';
      modelId = 'fal-ai/flux-pro/kontext';
      modelInput = {
        prompt: `Change only the background to ${scene}. Keep the person's face, hair, outfit, pose and expression exactly identical. Natural unretouched photo, realistic skin texture.`,
        image_url: photoUrl,
        seed: numSeed
      };
    } else if (preset === 'B') {
      presetLabel = 'Preset B (PuLID 0.9)';
      modelId = 'fal-ai/flux-pulid';
      modelInput = {
        prompt: `${scene}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`,
        reference_image_url: photoUrl,
        id_weight: 0.9,
        guidance_scale: 2.8,
        start_step: 1,
        true_cfg: 1.2,
        num_inference_steps: 35,
        seed: numSeed,
        image_size: { width: 1080, height: 1350 },
        max_sequence_length: '256',
        enable_safety_checker: true
      };
    } else if (preset === 'C') {
      presetLabel = 'Preset C (PuLID 0.8 Natural)';
      modelId = 'fal-ai/flux-pulid';
      modelInput = {
        prompt: `${scene}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`,
        reference_image_url: photoUrl,
        id_weight: 0.8,
        guidance_scale: 2.5,
        start_step: 2,
        true_cfg: 1.0,
        num_inference_steps: 40,
        seed: numSeed,
        image_size: { width: 1080, height: 1350 },
        max_sequence_length: '256',
        enable_safety_checker: true
      };
    } else if (preset === 'D') {
      presetLabel = 'Preset D (Kontext + Upscaler 0.2 + Film Grain σ=2)';
      modelId = 'fal-ai/flux-pro/kontext';
      modelInput = {
        prompt: `Change only the background to ${scene}. Keep the person's face, hair, outfit, pose and expression exactly identical. Natural unretouched photo, realistic skin texture.`,
        image_url: photoUrl,
        seed: numSeed
      };
      isPipelineD = true;
    } else if (preset === 'custom' && customConfig) {
      presetLabel = 'Custom Run';
      modelId = customConfig.model || 'fal-ai/flux-pulid';
      modelInput = { ...customConfig.input };
      // Inject photo if not explicitly provided
      if (!modelInput.image_url && !modelInput.reference_image_url) {
        if (modelId.includes('kontext')) {
          modelInput.image_url = photoUrl;
        } else {
          modelInput.reference_image_url = photoUrl;
        }
      }
      if (!modelInput.seed) modelInput.seed = numSeed;
    } else {
      throw new Error(`Unknown preset: ${preset}`);
    }

    console.log(`[LAB RUN] Subscribing to ${modelId}...`);
    const result = await fal.subscribe(modelId, { input: modelInput });
    const images = result.data?.images || result.images;
    let finalImageUrl = images?.[0]?.url || result.data?.image?.url || result.image?.url;

    if (!finalImageUrl) {
      throw new Error(`No image URL returned by ${modelId}. Result structure: ` + JSON.stringify(result));
    }

    // Preset D Multi-stage: Pass through clarity upscaler + apply sharp film grain
    if (isPipelineD) {
      console.log(`[LAB RUN D] Stage 2: Passing to fal-ai/clarity-upscaler with creativity 0.2...`);
      const upscaleResult = await fal.subscribe('fal-ai/clarity-upscaler', {
        input: {
          image_url: finalImageUrl,
          creativity: 0.2,
          prompt: 'masterpiece, sharp photography, natural skin texture, visible pores',
          upscale_factor: 2
        }
      });
      const upscaledImages = upscaleResult.data?.images || upscaleResult.images;
      const upscaledUrl = upscaledImages?.[0]?.url || upscaleResult.data?.image?.url;
      if (upscaledUrl) {
        finalImageUrl = upscaledUrl;
      }
    }

    // Download generated image locally to results directory
    const runId = `run_${Date.now()}`;
    const imgResponse = await fetch(finalImageUrl);
    let finalBuffer = Buffer.from(await imgResponse.arrayBuffer());

    // If Preset D, apply sharp film grain (sigma ~2)
    if (isPipelineD) {
      console.log(`[LAB RUN D] Stage 3: Applying sharp film grain (sigma ~2)...`);
      finalBuffer = await applySharpFilmGrain(finalBuffer, 2.0);
    }

    const localFileName = `${runId}.jpg`;
    const localFilePath = path.join(RESULTS_DIR, localFileName);
    fs.writeFileSync(localFilePath, finalBuffer);

    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';

    const resultRecord = {
      id: runId,
      preset,
      presetLabel,
      model: isPipelineD ? 'flux-pro/kontext + clarity-upscaler + film grain' : modelId,
      params: modelInput,
      seed: modelInput.seed ?? numSeed,
      runtime: runtimeStr,
      timestamp: new Date().toISOString(),
      imageUrl: `/api/lab/results/${localFileName}`,
      remoteUrl: finalImageUrl,
      hasOriginal: true
    };

    // Save JSON record
    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(resultRecord, null, 2), 'utf8');

    // Update state.json with latest scene, seed, and lastConfig
    saveLabState({
      scene,
      seed: numSeed,
      lastConfig: { model: modelId, input: modelInput }
    });

    console.log(`[LAB RUN COMPLETE] ${runId} in ${runtimeStr}`);
    res.json({ success: true, result: resultRecord });

  } catch (error) {
    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';
    const errorDetail = error?.body?.detail || error?.message || error?.toString();
    console.error(`[LAB RUN ERROR] after ${runtimeStr}:`, errorDetail);

    res.status(400).json({
      success: false,
      error: errorDetail,
      runtime: runtimeStr
    });
  }
});

export default router;
