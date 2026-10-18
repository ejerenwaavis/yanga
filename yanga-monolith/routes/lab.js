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

// Startup Cleanup: Mark any dangling runs left in "running" or "queued" as "interrupted"
function cleanupDanglingRunsOnStartup() {
  try {
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    let interruptedCount = 0;
    for (const file of files) {
      try {
        const filePath = path.join(RESULTS_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.status === 'running' || data.status === 'queued') {
          data.status = 'interrupted';
          data.error = 'Server restarted during execution. Run marked as interrupted.';
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
          interruptedCount++;
        }
      } catch {}
    }
    if (interruptedCount > 0) {
      console.log(`[LAB STARTUP] Marked ${interruptedCount} dangling runs as 'interrupted'.`);
    }
  } catch (err) {
    console.warn('[LAB STARTUP] Could not clean dangling runs:', err.message);
  }
}
cleanupDanglingRunsOnStartup();

// Active background jobs registry: runId -> { timeoutId, isCanceled }
const activeJobs = new Map();

// Multer memory storage for original photo uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();

// Fallback pricing table per run (in USD)
const MODEL_PRICING = {
  'fal-ai/flux-pro/kontext': 0.040,
  'fal-ai/flux-pulid': 0.035,
  'fal-ai/clarity-upscaler': 0.020,
  'fal-ai/nano-banana/edit': 0.015,
  'fal-ai/nano-banana-pro': 0.025,
  'fal-ai/bytedance/seedream/v4.5/edit': 0.025,
  'fal-ai/bytedance/seedream/v4/edit': 0.020,
  'realism_pass': 0.000
};

/**
 * Read or initialize state.json
 */
function readLabState() {
  const defaultState = {
    mode: 'scene_only',
    scene: 'in a sleek modern high-rise executive corner office, sitting by floor-to-ceiling panoramic glass windows overlooking city skyline, clean modern architectural interior, crisp natural window light, commanding executive confidence',
    outfit: 'wearing an impeccably tailored bespoke Italian business suit with silk pocket square',
    outputSize: 'match_original',
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
 * Helper to update a specific run's JSON record
 */
function updateRunRecord(id, updates) {
  try {
    const jsonPath = path.join(RESULTS_DIR, `${id}.json`);
    if (fs.existsSync(jsonPath)) {
      const current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const updated = { ...current, ...updates };
      fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');
      return updated;
    }
  } catch (err) {
    console.error(`[LAB] Error updating run record ${id}:`, err);
  }
  return null;
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
 * Apply Gaussian film grain (sigma 1.5-2.5) via sharp
 */
async function applySharpFilmGrain(imageBuffer, sigma = 2.0) {
  try {
    const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true });
    
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

  if (req.path.startsWith('/api/') || req.originalUrl.includes('/api/lab')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing LAB_KEY.' });
  }

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

/**
 * Detached Asynchronous Background Worker for a single run
 */
async function processRunJob(runId, jobParams) {
  const { preset, mode, scene, outfit, outputSize, seed, customConfig, falKey } = jobParams;
  const numSeed = parseInt(seed, 10) || 42;
  const startTime = Date.now();

  console.log(`[LAB WORKER START] ${runId} - Preset: ${preset}`);
  updateRunRecord(runId, { status: 'running' });

  // 180 Second Timeout
  const timeoutId = setTimeout(() => {
    const job = activeJobs.get(runId);
    if (job && !job.isCanceled) {
      job.isCanceled = true;
      console.warn(`[LAB TIMEOUT] Run ${runId} timed out after 180 seconds.`);
      updateRunRecord(runId, {
        status: 'error',
        error: 'Job timed out after 180 seconds. The model did not complete within the maximum allowable window.',
        runtime: '180.0s'
      });
      activeJobs.delete(runId);
    }
  }, 180000);

  activeJobs.set(runId, { timeoutId, isCanceled: false });

  try {
    fal.config({ credentials: falKey });

    const photoBuffer = fs.readFileSync(ORIGINAL_PHOTO_PATH);
    const photoUrl = await uploadToFalStorage(photoBuffer, 'image/jpeg');

    if (activeJobs.get(runId)?.isCanceled) return;

    let editPrompt = '';
    if (mode === 'scene_outfit' && outfit && outfit.trim()) {
      editPrompt = `Change the background to ${scene.trim()} and change the outfit to ${outfit.trim()}. Keep the person's face, hair, pose and expression exactly identical. Natural unretouched photo.`;
    } else {
      editPrompt = `Change only the background to ${scene.trim()}. Keep the person's face, hair, outfit, pose and expression exactly identical. Natural unretouched photo.`;
    }

    let modelId = '';
    let modelInput = {};
    let presetLabel = '';
    let isPipelineD = false;
    let estimatedCost = 0.040;

    let kontextDimensions = null;
    let aspectEnum = 'auto';
    if (outputSize === '4:5') {
      kontextDimensions = { width: 1080, height: 1350 };
      aspectEnum = '4:5';
    } else if (outputSize === '9:16') {
      kontextDimensions = { width: 1080, height: 1920 };
      aspectEnum = '9:16';
    }

    if (preset === 'A') {
      presetLabel = 'Preset A (Flux-Pro Kontext)';
      modelId = 'fal-ai/flux-pro/kontext';
      modelInput = { prompt: editPrompt, image_url: photoUrl, seed: numSeed };
      if (kontextDimensions) modelInput.image_size = kontextDimensions;
      estimatedCost = MODEL_PRICING['fal-ai/flux-pro/kontext'];
    } else if (preset === 'B') {
      presetLabel = 'Preset B (PuLID 0.9)';
      modelId = 'fal-ai/flux-pulid';
      const pulidPrompt = mode === 'scene_outfit' && outfit
        ? `${scene}, wearing ${outfit}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`
        : `${scene}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`;

      modelInput = {
        prompt: pulidPrompt,
        reference_image_url: photoUrl,
        id_weight: 0.9,
        guidance_scale: 2.8,
        start_step: 1,
        true_cfg: 1.2,
        num_inference_steps: 35,
        seed: numSeed,
        image_size: kontextDimensions || { width: 1080, height: 1350 },
        max_sequence_length: '256',
        enable_safety_checker: true
      };
      estimatedCost = MODEL_PRICING['fal-ai/flux-pulid'];
    } else if (preset === 'C') {
      presetLabel = 'Preset C (PuLID 0.8 Natural)';
      modelId = 'fal-ai/flux-pulid';
      const pulidPrompt = mode === 'scene_outfit' && outfit
        ? `${scene}, wearing ${outfit}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`
        : `${scene}, Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.`;

      modelInput = {
        prompt: pulidPrompt,
        reference_image_url: photoUrl,
        id_weight: 0.8,
        guidance_scale: 2.5,
        start_step: 2,
        true_cfg: 1.0,
        num_inference_steps: 40,
        seed: numSeed,
        image_size: kontextDimensions || { width: 1080, height: 1350 },
        max_sequence_length: '256',
        enable_safety_checker: true
      };
      estimatedCost = MODEL_PRICING['fal-ai/flux-pulid'];
    } else if (preset === 'D') {
      presetLabel = 'Preset D (Kontext + Upscaler 0.2 + Film Grain σ=2)';
      modelId = 'fal-ai/flux-pro/kontext';
      modelInput = { prompt: editPrompt, image_url: photoUrl, seed: numSeed };
      if (kontextDimensions) modelInput.image_size = kontextDimensions;
      isPipelineD = true;
      estimatedCost = MODEL_PRICING['fal-ai/flux-pro/kontext'] + MODEL_PRICING['fal-ai/clarity-upscaler'];
    } else if (preset === 'E') {
      presetLabel = 'Preset E (Nano Banana Edit)';
      modelId = 'fal-ai/nano-banana/edit';
      modelInput = { prompt: editPrompt, image_urls: [photoUrl], image_url: photoUrl, num_images: 1, seed: numSeed };
      if (aspectEnum !== 'auto') modelInput.aspect_ratio = aspectEnum;
      estimatedCost = MODEL_PRICING['fal-ai/nano-banana/edit'];
    } else if (preset === 'F') {
      presetLabel = 'Preset F (Seedream Edit)';
      modelId = 'fal-ai/bytedance/seedream/v4.5/edit';
      modelInput = { prompt: editPrompt, image_urls: [photoUrl], image_url: photoUrl, num_images: 1, seed: numSeed };
      estimatedCost = MODEL_PRICING['fal-ai/bytedance/seedream/v4.5/edit'];
    } else if (preset === 'custom' && customConfig) {
      presetLabel = 'Custom Run';
      modelId = customConfig.model || 'fal-ai/flux-pulid';
      modelInput = { ...customConfig.input };
      if (!modelInput.image_url && !modelInput.reference_image_url && !modelInput.image_urls) {
        if (modelId.includes('kontext')) {
          modelInput.image_url = photoUrl;
        } else if (modelId.includes('banana') || modelId.includes('seedream')) {
          modelInput.image_urls = [photoUrl];
          modelInput.image_url = photoUrl;
        } else {
          modelInput.reference_image_url = photoUrl;
        }
      }
      if (!modelInput.seed) modelInput.seed = numSeed;
      estimatedCost = MODEL_PRICING[modelId] || 0.035;
    }

    if (activeJobs.get(runId)?.isCanceled) return;

    let result = null;
    try {
      result = await fal.subscribe(modelId, { input: modelInput });
    } catch (primaryErr) {
      if (preset === 'F' && (primaryErr.status === 404 || primaryErr.message?.includes('not found') || primaryErr.body?.detail?.includes('not found'))) {
        console.warn('[LAB WORKER] Seedream v4.5 not found, falling back to fal-ai/bytedance/seedream/v4/edit');
        modelId = 'fal-ai/bytedance/seedream/v4/edit';
        result = await fal.subscribe(modelId, { input: modelInput });
      } else {
        throw primaryErr;
      }
    }

    if (activeJobs.get(runId)?.isCanceled) return;

    const images = result.data?.images || result.images;
    let finalImageUrl = images?.[0]?.url || result.data?.image?.url || result.image?.url;
    if (!finalImageUrl) {
      throw new Error(`No image URL returned by ${modelId}. Result: ` + JSON.stringify(result));
    }

    const actualCost = result.data?.usage?.cost ?? result.usage?.cost ?? result.data?.cost ?? estimatedCost;

    // Preset D multi-stage
    if (isPipelineD) {
      console.log(`[LAB WORKER D] Stage 2: Passing to fal-ai/clarity-upscaler...`);
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
      if (upscaledUrl) finalImageUrl = upscaledUrl;
    }

    if (activeJobs.get(runId)?.isCanceled) return;

    const imgResponse = await fetch(finalImageUrl);
    let finalBuffer = Buffer.from(await imgResponse.arrayBuffer());

    if (isPipelineD) {
      console.log(`[LAB WORKER D] Stage 3: Applying sharp film grain (sigma ~2)...`);
      finalBuffer = await applySharpFilmGrain(finalBuffer, 2.0);
    }

    const localFileName = `${runId}.jpg`;
    const localFilePath = path.join(RESULTS_DIR, localFileName);
    fs.writeFileSync(localFilePath, finalBuffer);

    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';

    // Mark as done
    updateRunRecord(runId, {
      status: 'done',
      model: isPipelineD ? 'flux-pro/kontext + clarity-upscaler + film grain' : modelId,
      params: modelInput,
      seed: modelInput.seed ?? numSeed,
      runtime: runtimeStr,
      cost: typeof actualCost === 'number' ? actualCost : parseFloat(actualCost) || estimatedCost,
      imageUrl: `/api/lab/results/${localFileName}`,
      remoteUrl: finalImageUrl
    });

    saveLabState({
      mode,
      scene,
      outfit,
      outputSize,
      seed: numSeed,
      lastConfig: { model: modelId, input: modelInput }
    });

    console.log(`[LAB WORKER DONE] ${runId} in ${runtimeStr}`);
  } catch (error) {
    const job = activeJobs.get(runId);
    if (job?.isCanceled) {
      console.log(`[LAB WORKER] Run ${runId} canceled by user.`);
      return;
    }

    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';
    const errorDetail = error?.body?.detail || error?.message || error?.toString();
    console.error(`[LAB WORKER ERROR] ${runId} after ${runtimeStr}:`, errorDetail);

    updateRunRecord(runId, {
      status: 'error',
      error: errorDetail,
      runtime: runtimeStr
    });
  } finally {
    const job = activeJobs.get(runId);
    if (job?.timeoutId) clearTimeout(job.timeoutId);
    activeJobs.delete(runId);
  }
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
    .container { max-width: 1060px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    
    /* Top Bar */
    .topbar { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; font-size: 0.8rem; flex-wrap: wrap; gap: 8px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.25); color: var(--amber); font-weight: 600; font-size: 0.75rem; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
    .cost-total-badge { background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399; padding: 4px 10px; border-radius: 8px; font-weight: 700; font-size: 0.75rem; }

    /* Cards */
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
    .card-title { font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #e4e4e7; display: flex; align-items: center; gap: 8px; }
    .card-title span.num { width: 22px; height: 22px; border-radius: 50%; background: var(--amber); color: #000; font-weight: 900; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; }

    /* Upload Area */
    .upload-container { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
    .thumb-wrap { width: 140px; height: 180px; border-radius: 10px; overflow: hidden; border: 2px solid var(--amber); position: relative; background: #000; }
    .thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
    .upload-btn-label { display: inline-block; background: #27272a; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; border: 1px solid #3f3f46; transition: background 0.15s; }
    .upload-btn-label:hover { background: #3f3f46; }

    /* Inputs */
    label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px; }
    textarea, input[type="text"], input[type="number"], select { width: 100%; background: #09090b; border: 1px solid var(--card-border); border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.85rem; font-family: inherit; outline: none; }
    textarea:focus, input:focus, select:focus { border-color: var(--amber); }
    textarea { min-height: 80px; resize: vertical; }

    /* Segmented Mode Toggle */
    .toggle-group { display: inline-flex; background: #09090b; border: 1px solid var(--card-border); border-radius: 8px; padding: 3px; gap: 3px; }
    .toggle-btn { background: transparent; border: none; color: var(--text-muted); padding: 6px 14px; font-size: 0.78rem; font-weight: 700; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
    .toggle-btn.active { background: var(--amber); color: #09090b; }

    /* Preset Grid */
    .presets-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
    .preset-card { background: #1c1c21; border: 1px solid #2e2e36; border-radius: 10px; padding: 0.9rem; transition: all 0.15s; display: flex; flex-direction: column; justify-content: space-between; position: relative; }
    .preset-card:hover { border-color: var(--amber); }
    .preset-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .preset-checkbox { width: 16px; height: 16px; accent-color: var(--amber); cursor: pointer; }
    .preset-btn { background: transparent; border: none; text-align: left; cursor: pointer; padding: 0; width: 100%; color: inherit; }
    .preset-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .p-tag { font-size: 0.7rem; font-weight: 800; color: var(--amber); text-transform: uppercase; }
    .p-cost { font-size: 0.7rem; color: #34d399; font-weight: 600; }
    .p-title { font-size: 0.85rem; font-weight: 700; color: #fff; line-height: 1.3; margin: 4px 0; }
    .p-desc { font-size: 0.72rem; color: var(--text-muted); line-height: 1.4; }

    /* Run Selected Button */
    .btn-run-all { background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-weight: 800; font-size: 0.9rem; padding: 0.85rem 1.25rem; border: none; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: opacity 0.15s; box-shadow: 0 4px 14px rgba(245,158,11,0.25); }
    .btn-run-all:hover:not(:disabled) { opacity: 0.9; }
    .btn-run-all:disabled { opacity: 0.4; cursor: not-allowed; }

    /* Custom JSON card & Toggle */
    .toggle-custom-btn { background: transparent; border: 1px dashed #3f3f46; color: var(--text-muted); padding: 8px 14px; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; width: 100%; text-align: center; transition: all 0.15s; }
    .toggle-custom-btn:hover { border-color: var(--amber); color: #fff; }
    .code-box { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.78rem; background: #000; color: #a5f3fc; border: 1px solid #222; }

    /* Results Gallery */
    .results-gallery { display: flex; flex-direction: column; gap: 1.5rem; }
    .result-card { background: #141417; border: 1px solid var(--card-border); border-radius: 14px; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; transition: border-color 0.2s; }
    .result-card.running { border-color: var(--amber); }
    .result-card.failed { border-color: rgba(239,68,68,0.5); background: #181113; }
    .res-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid #222; padding-bottom: 0.75rem; }
    .res-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; }
    .res-badge { padding: 2px 8px; border-radius: 6px; background: rgba(245,158,11,0.15); color: var(--amber); font-weight: 700; font-size: 0.72rem; }
    .res-model { padding: 2px 8px; border-radius: 6px; background: #27272a; color: #d4d4d8; font-family: monospace; font-size: 0.7rem; }
    .res-runtime { color: #10b981; font-weight: 600; }
    .res-cost { color: #34d399; font-weight: 700; }
    .res-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .res-btn { background: #27272a; border: 1px solid #3f3f46; color: #fff; padding: 5px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
    .res-btn:hover { background: #3f3f46; }
    .res-btn.realism { background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.4); color: var(--amber); font-weight: 700; }
    .res-btn.realism:hover { background: rgba(245,158,11,0.3); }
    .res-btn.delete { color: #f87171; border-color: rgba(239,68,68,0.3); }
    .res-btn.delete:hover { background: rgba(239,68,68,0.15); }
    .res-btn.cancel { background: #7f1d1d; border-color: #ef4444; color: #fecaca; font-weight: 700; }
    .res-btn.cancel:hover { background: #991b1b; }

    /* Side by Side Image Container */
    .compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 640px) { .compare-grid { grid-template-columns: 1fr; } }
    .comp-col { display: flex; flex-direction: column; gap: 6px; }
    .comp-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); }
    .comp-img { width: 100%; max-height: 480px; object-fit: contain; border-radius: 10px; background: #000; border: 1px solid #27272a; }
    .running-box { width: 100%; min-height: 260px; border-radius: 10px; background: #09090b; border: 2px dashed rgba(245,158,11,0.4); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 1.5rem; text-align: center; }
    .error-box { width: 100%; min-height: 180px; border-radius: 10px; background: #260a0a; border: 1px solid #dc2626; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 1.25rem; text-align: center; }

    /* Stars & Notes */
    .rating-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-top: 6px; border-top: 1px solid #222; }
    .star-btn { background: transparent; border: none; font-size: 1.15rem; color: #3f3f46; cursor: pointer; padding: 0 2px; transition: color 0.15s; }
    .star-btn.active, .star-btn:hover { color: var(--amber); }
    .notes-input { flex: 1; min-width: 200px; background: #09090b; border: 1px solid #27272a; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 0.78rem; outline: none; }
    .notes-input:focus { border-color: var(--amber); }

    /* Realism Pass Modal / Inline Panel */
    .realism-panel { background: #09090b; border: 1px solid rgba(245,158,11,0.3); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }

    /* Progress Overlay */
    .progress-bar { background: #27272a; border-radius: 6px; overflow: hidden; height: 8px; width: 100%; margin-top: 6px; display: none; }
    .progress-fill { background: var(--amber); height: 100%; width: 0%; transition: width 0.3s; }
    .alert-err { background: #450a0a; border: 1px solid #ef4444; color: #fca5a5; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.8rem; display: none; }
    
    /* Spinner */
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(245,158,11,0.2); border-top-color: var(--amber); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Top Bar -->
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="status-dot"></span>
        <span style="font-weight:700;">Yanga Studio Lab</span>
        <span class="badge">Background Worker Engine</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div id="topTotalSpend" class="cost-total-badge">Total Spend: $0.000</div>
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

    <!-- STEP 2: Scene, Outfit Toggle, Output Size & Seed -->
    <div class="card">
      <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="num">2</span>
          <span>Prompt & Framing Calibration</span>
        </div>
        
        <!-- Scene Only vs Scene + Outfit Change Toggle -->
        <div class="toggle-group">
          <button type="button" class="toggle-btn active" id="btnModeSceneOnly" onclick="setMode('scene_only')">Scene Only</button>
          <button type="button" class="toggle-btn" id="btnModeSceneOutfit" onclick="setMode('scene_outfit')">Scene + Outfit Change</button>
        </div>
      </div>

      <!-- Scene Description -->
      <div>
        <label>Scene Description (Destination environment, lighting & interior)</label>
        <textarea id="sceneInput" placeholder="Describe the scene environment, lighting, and interior..."></textarea>
      </div>

      <!-- Outfit Description (Conditional) -->
      <div id="outfitContainer" style="display:none;">
        <label>Outfit Instruction (Replaces original clothes while keeping face & pose identical)</label>
        <input type="text" id="outfitInput" placeholder="e.g. wearing an impeccably tailored navy bespoke Italian suit with silk pocket square">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 120px;gap:12px;align-items:end;">
        <!-- Output Size for Kontext Presets -->
        <div>
          <label>Kontext Output Size</label>
          <select id="kontextSizeSelect" onchange="saveCurrentState()">
            <option value="match_original">Match Original Aspect Ratio (Default)</option>
            <option value="4:5">4:5 (IG Portrait Feed - 1080x1350)</option>
            <option value="9:16">9:16 (Story / Reel - 1080x1920)</option>
          </select>
        </div>

        <!-- Seed Input -->
        <div>
          <label>Seed (Locks latent noise)</label>
          <input type="number" id="seedInput" value="42">
        </div>

        <!-- Randomize Seed Button -->
        <button type="button" class="upload-btn-label" style="text-align:center;padding:10px;" onclick="document.getElementById('seedInput').value = Math.floor(Math.random() * 9999999); saveCurrentState();">
          🎲 Seed
        </button>
      </div>
    </div>

    <!-- STEP 3: Presets & Run Selected -->
    <div class="card">
      <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="num">3</span>
          <span>Image-Edit & In-Context Models (A through F)</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="res-btn" onclick="toggleAllPresets(true)">Select All</button>
          <button type="button" class="res-btn" onclick="toggleAllPresets(false)">Deselect All</button>
        </div>
      </div>
      
      <div class="presets-grid">
        <!-- Preset A -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset A</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.040</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetA" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetA" onclick="runPreset('A')">
            <div class="p-title">FLUX.1 Kontext [pro]</div>
            <div class="p-desc">In-context background & outfit swap. Locks exact face, hair, and pose.</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">fal-ai/flux-pro/kontext ↗</div>
          </button>
        </div>

        <!-- Preset B -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset B</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.035</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetB" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetB" onclick="runPreset('B')">
            <div class="p-title">PuLID Baseline 0.9</div>
            <div class="p-desc">id_weight 0.9, CFG 1.2, guidance 2.8, start_step 1, 35 steps.</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">fal-ai/flux-pulid ↗</div>
          </button>
        </div>

        <!-- Preset C -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset C</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.035</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetC" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetC" onclick="runPreset('C')">
            <div class="p-title">PuLID Natural 0.8</div>
            <div class="p-desc">id_weight 0.8, CFG 1.0 (pure flow), guidance 2.5, start_step 2, 40 steps.</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">fal-ai/flux-pulid ↗</div>
          </button>
        </div>

        <!-- Preset D -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset D</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.060</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetD" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetD" onclick="runPreset('D')">
            <div class="p-title">Kontext + Upscale + Grain</div>
            <div class="p-desc">Preset A output &rarr; Clarity Upscaler (creativity 0.2) &rarr; Film Grain (&sigma;&approx;2).</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">Multi-Stage Pipeline ↗</div>
          </button>
        </div>

        <!-- Preset E: Nano Banana Edit -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset E</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.015</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetE" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetE" onclick="runPreset('E')">
            <div class="p-title">Nano Banana Edit</div>
            <div class="p-desc">Gemini multimodal image editor. Edits background while preserving human subject.</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">fal-ai/nano-banana/edit ↗</div>
          </button>
        </div>

        <!-- Preset F: Seedream Edit -->
        <div class="preset-card">
          <div class="preset-header">
            <span class="p-tag">Preset F</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="p-cost">~$0.025</span>
              <input type="checkbox" class="preset-checkbox" id="chkPresetF" checked onchange="updateSelectedCount()">
            </div>
          </div>
          <button type="button" class="preset-btn" id="btnPresetF" onclick="runPreset('F')">
            <div class="p-title">Seedream Edit</div>
            <div class="p-desc">ByteDance Seedream image-to-image editor with high compositional accuracy.</div>
            <div style="font-size:0.72rem;color:var(--amber);margin-top:6px;">bytedance/seedream edit ↗</div>
          </button>
        </div>
      </div>

      <!-- Run Selected Button & Progress Bar -->
      <button type="button" class="btn-run-all" id="btnRunSelected" onclick="runSelectedSequential()">
        <span id="runSelectedLabel">⚡ Run Selected Presets (6 of 6 Selected)</span>
      </button>
      <div id="runProgressText" style="font-size:0.78rem;color:var(--amber);font-weight:600;display:none;"></div>
      <div id="progressBar" class="progress-bar">
        <div id="progressFill" class="progress-fill"></div>
      </div>
    </div>

    <!-- Toggleable Custom JSON Sandbox Button -->
    <div>
      <button type="button" id="btnToggleCustom" class="toggle-custom-btn" onclick="toggleCustomSection()">
        🛠️ Show Custom JSON Sandbox (Single Parameter Tweaks) ▼
      </button>
    </div>

    <!-- STEP 4: Custom Run Editor (Hidden by default) -->
    <div class="card" id="customConfigCard" style="display:none;">
      <div class="card-title">
        <span class="num">4</span>
        <span>Custom Configuration Sandbox (Single Parameter Tweaks)</span>
      </div>
      <div>
        <label>Editable JSON Configuration (Prefilled with last run)</label>
        <textarea id="customJsonInput" class="code-box" style="min-height:160px;"></textarea>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="res-btn" onclick="populateCustomPreset('A')">Load A</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('B')">Load B</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('C')">Load C</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('E')">Load E</button>
          <button type="button" class="res-btn" onclick="populateCustomPreset('F')">Load F</button>
        </div>
        <button type="button" class="upload-btn-label" id="btnRunCustom" style="background:var(--amber);color:#000;border:none;font-weight:700;" onclick="runCustom()">
          ▶ Run Custom Config
        </button>
      </div>
    </div>

    <!-- STEP 5: Results Gallery -->
    <div class="card">
      <div class="card-title" style="justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="num">5</span>
          <span>Results & Side-by-Side Comparison Gallery</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span id="gallerySpendTotal" style="font-size:0.75rem;color:#34d399;font-weight:700;">$0.000 spent</span>
          <select id="sortSelect" onchange="renderResults(currentResults)" style="padding:4px 8px;font-size:0.75rem;width:auto;">
            <option value="newest">Sort: Newest First</option>
            <option value="rating_desc">Sort: Highest Rated (★)</option>
            <option value="rating_asc">Sort: Lowest Rated</option>
            <option value="oldest">Sort: Oldest First</option>
          </select>
          <span id="resultsCount" style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;">0 runs</span>
        </div>
      </div>
      <div id="resultsGallery" class="results-gallery">
        <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">
          No test runs completed yet. Upload a photo and pick a preset above!
        </div>
      </div>
    </div>

  </div>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('key');
    if (keyFromUrl) {
      localStorage.setItem('yanga_lab_key', keyFromUrl);
    }
    const LAB_KEY = localStorage.getItem('yanga_lab_key') || '${labKey}';
    let currentResults = [];
    let currentMode = 'scene_only';
    let pollTimer = null;
    let isSequenceRunning = false;

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

    function toggleCustomSection() {
      const card = document.getElementById('customConfigCard');
      const btn = document.getElementById('btnToggleCustom');
      if (card.style.display === 'none') {
        card.style.display = 'flex';
        btn.textContent = '▲ Hide Custom JSON Sandbox';
      } else {
        card.style.display = 'none';
        btn.textContent = '🛠️ Show Custom JSON Sandbox (Single Parameter Tweaks) ▼';
      }
    }

    function setMode(mode) {
      currentMode = mode;
      document.getElementById('btnModeSceneOnly').classList.toggle('active', mode === 'scene_only');
      document.getElementById('btnModeSceneOutfit').classList.toggle('active', mode === 'scene_outfit');
      document.getElementById('outfitContainer').style.display = mode === 'scene_outfit' ? 'block' : 'none';
      saveCurrentState();
    }

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
            setMode(data.state.mode || 'scene_only');
            document.getElementById('sceneInput').value = data.state.scene || '';
            document.getElementById('outfitInput').value = data.state.outfit || '';
            document.getElementById('seedInput').value = data.state.seed ?? 42;
            if (data.state.outputSize) {
              document.getElementById('kontextSizeSelect').value = data.state.outputSize;
            }
            if (data.state.lastConfig) {
              document.getElementById('customJsonInput').value = JSON.stringify(data.state.lastConfig, null, 2);
            }
          }
        }
      } catch (err) {
        showError('Could not load lab state: ' + err.message);
      }
    }

    async function saveCurrentState() {
      const scene = document.getElementById('sceneInput').value;
      const outfit = document.getElementById('outfitInput').value;
      const outputSize = document.getElementById('kontextSizeSelect').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;
      try {
        await labFetch('/api/lab/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: currentMode, scene, outfit, outputSize, seed })
        });
      } catch (err) {
        console.warn('Could not save state:', err);
      }
    }
    document.getElementById('sceneInput').addEventListener('blur', saveCurrentState);
    document.getElementById('outfitInput').addEventListener('blur', saveCurrentState);
    document.getElementById('seedInput').addEventListener('blur', saveCurrentState);

    async function handlePhotoUpload(file) {
      if (!file) return;
      showError(null);
      document.getElementById('photoStatusText').textContent = 'Uploading test photo...';
      const fd = new FormData();
      fd.append('photo', file);

      try {
        const res = await labFetch('/api/lab/upload', { method: 'POST', body: fd });
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

    async function loadResults() {
      try {
        const res = await labFetch('/api/lab/results');
        const data = await res.json();
        if (data.success && Array.isArray(data.results)) {
          currentResults = data.results;
          renderResults(currentResults);
          
          // Check if any jobs are currently active (queued or running)
          const hasActive = currentResults.some(r => r.status === 'queued' || r.status === 'running');
          if (hasActive) {
            startPolling();
          } else {
            stopPolling();
          }
        }
      } catch (err) {
        console.warn('Failed to load results:', err);
      }
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        loadResults();
      }, 3000);
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function renderResults(results) {
      const countEl = document.getElementById('resultsCount');
      const gallery = document.getElementById('resultsGallery');
      const sortVal = document.getElementById('sortSelect').value;

      const sorted = [...results].sort((a, b) => {
        if (a.status === 'running' || a.status === 'queued') return -1;
        if (b.status === 'running' || b.status === 'queued') return 1;
        if (sortVal === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
        if (sortVal === 'rating_asc') return (a.rating || 0) - (b.rating || 0);
        if (sortVal === 'oldest') return new Date(a.timestamp) - new Date(b.timestamp);
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

      const totalCost = results.reduce((sum, r) => sum + (parseFloat(r.cost) || 0), 0);
      const costStr = '$' + totalCost.toFixed(3);
      document.getElementById('topTotalSpend').textContent = 'Total Spend: ' + costStr;
      document.getElementById('gallerySpendTotal').textContent = costStr + ' total spend';

      countEl.textContent = sorted.length + ' run' + (sorted.length === 1 ? '' : 's');

      if (!sorted.length) {
        gallery.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.85rem;">No test runs yet. Pick a preset above!</div>';
        return;
      }

      gallery.innerHTML = sorted.map(r => {
        const origUrl = '/api/lab/original?key=' + encodeURIComponent(LAB_KEY);
        const genUrl = r.imageUrl ? (r.imageUrl.startsWith('http') ? r.imageUrl : r.imageUrl + '?key=' + encodeURIComponent(LAB_KEY)) : r.remoteUrl;
        const jsonStr = JSON.stringify(r.params || {}, null, 2);
        const rating = r.rating || 0;
        const notes = r.notes || '';
        const costBadge = r.cost != null ? \`<span class="res-cost">💰 $\${parseFloat(r.cost).toFixed(3)}</span>\` : '';
        const parentBadge = r.parentRunId ? \`<span class="res-badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;">🔗 Linked to #\${r.parentRunId}</span>\` : '';

        // Status Card 1: QUEUED OR RUNNING CARD
        if (r.status === 'queued' || r.status === 'running') {
          const statusText = r.status === 'queued' ? '⏳ Queued in Worker...' : '⚡ Running on Fal GPU...';
          return \`
            <div class="result-card running" id="card-\${r.id}">
              <div class="res-header">
                <div class="res-meta">
                  <span class="res-badge" style="background:#f59e0b;color:#000;font-weight:800;">\${statusText}</span>
                  <span class="res-badge">\${r.presetLabel || r.preset || 'Run'}</span>
                  <span class="res-model">\${r.model}</span>
                  <span>Seed: <strong>\${r.seed ?? 'N/A'}</strong></span>
                </div>
                <div class="res-actions">
                  <button type="button" class="res-btn cancel" onclick="cancelRun('\${r.id}')">🚫 Cancel Job</button>
                </div>
              </div>
              <div class="compare-grid">
                <div class="comp-col">
                  <span class="comp-label">Original Reference</span>
                  <img src="\${origUrl}" class="comp-img" alt="Original Reference" />
                </div>
                <div class="comp-col">
                  <span class="comp-label">Live Status</span>
                  <div class="running-box">
                    <div class="spinner"></div>
                    <div style="font-weight:700;color:#fff;font-size:0.9rem;">\${statusText}</div>
                    <p style="font-size:0.75rem;color:var(--text-muted);max-width:280px;">Executing in background worker. Page polls automatically every 3s. Refreshing is completely safe.</p>
                  </div>
                </div>
              </div>
            </div>
          \`;
        }

        // Status Card 2: ERROR, INTERRUPTED, OR CANCELED CARD
        if (r.status === 'error' || r.status === 'interrupted' || r.status === 'canceled') {
          const badgeClass = r.status === 'error' ? 'background:#ef4444;color:#fff;' : 'background:#f59e0b;color:#000;';
          const label = r.status === 'error' ? '❌ Failed' : (r.status === 'interrupted' ? '⚠️ Interrupted' : '🚫 Canceled');
          return \`
            <div class="result-card failed" id="card-\${r.id}">
              <div class="res-header">
                <div class="res-meta">
                  <span class="res-badge" style="\${badgeClass}font-weight:800;">\${label}</span>
                  <span class="res-badge">\${r.presetLabel || r.preset || 'Run'}</span>
                  <span class="res-model">\${r.model}</span>
                  <span class="res-runtime">⚡ \${r.runtime || 'N/A'}</span>
                </div>
                <div class="res-actions">
                  <button type="button" class="res-btn delete" onclick="deleteRun('\${r.id}')">🗑 Delete</button>
                </div>
              </div>
              <div class="compare-grid">
                <div class="comp-col">
                  <span class="comp-label">Original Reference</span>
                  <img src="\${origUrl}" class="comp-img" alt="Original Reference" />
                </div>
                <div class="comp-col">
                  <span class="comp-label">Failure Diagnostic</span>
                  <div class="error-box">
                    <div style="font-weight:700;color:#fca5a5;font-size:0.85rem;">Run Terminated with Error:</div>
                    <div style="font-family:monospace;font-size:0.75rem;color:#fecaca;max-height:160px;overflow-y:auto;text-align:left;background:#180606;padding:8px;border-radius:6px;width:100%;box-sizing:border-box;">
                      \${r.error || 'Unknown error occurred'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          \`;
        }

        // Status Card 3: COMPLETED SUCCESSFUL RUN (status === 'done')
        let starsHtml = '';
        for (let s = 1; s <= 5; s++) {
          starsHtml += \`<button type="button" class="star-btn \${s <= rating ? 'active' : ''}" onclick="saveRating('\${r.id}', \${s})">★</button>\`;
        }

        return \`
          <div class="result-card" id="card-\${r.id}">
            <div class="res-header">
              <div class="res-meta">
                <span class="res-badge">\${r.presetLabel || r.preset || 'Run'}</span>
                \${parentBadge}
                <span class="res-model">\${r.model}</span>
                <span>Seed: <strong>\${r.seed ?? 'N/A'}</strong></span>
                <span class="res-runtime">⚡ \${r.runtime || 'N/A'}</span>
                \${costBadge}
                <span style="color:var(--text-muted);">\${new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
              </div>
              <div class="res-actions">
                <button type="button" class="res-btn realism" onclick="toggleRealismPanel('\${r.id}')">✨ Realism Pass</button>
                <a href="\${genUrl}" download="\${r.id}.jpg" target="_blank" class="res-btn">⬇ Download</a>
                <button type="button" class="res-btn delete" onclick="deleteRun('\${r.id}')">🗑 Delete</button>
              </div>
            </div>

            <div id="realismPanel-\${r.id}" class="realism-panel" style="display:none;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.75rem;font-weight:700;color:var(--amber);">Apply Sharp-Only Realism Pass</span>
                <span id="sigmaVal-\${r.id}" style="font-size:0.75rem;color:#34d399;font-weight:700;">Grain &sigma; = 2.0</span>
              </div>
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0;">Adds fine Gaussian film grain with subtle contrast lift. Zero upscaler hallucinations.</p>
              <div style="display:flex;align-items:center;gap:10px;">
                <input type="range" id="sigmaSlider-\${r.id}" min="1.5" max="2.5" step="0.1" value="2.0" style="flex:1;accent-color:var(--amber);" oninput="document.getElementById('sigmaVal-\${r.id}').textContent = 'Grain &sigma; = ' + this.value">
                <button type="button" class="res-btn realism" onclick="applyRealismPass('\${r.id}')">Apply & Save</button>
              </div>
            </div>

            <div class="compare-grid">
              <div class="comp-col">
                <span class="comp-label">Original Reference</span>
                <img src="\${origUrl}" class="comp-img" alt="Original Reference" />
              </div>
              <div class="comp-col">
                <span class="comp-label">Generated Result (\${r.presetLabel || r.preset || 'Output'})</span>
                <img src="\${genUrl}" class="comp-img" alt="Generated Result" onclick="window.open('\${genUrl}', '_blank')" style="cursor:zoom-in;" />
              </div>
            </div>

            <div class="rating-row">
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="font-size:0.72rem;color:var(--text-muted);font-weight:700;margin-right:4px;">RATING:</span>
                \${starsHtml}
              </div>
              <input type="text" class="notes-input" placeholder="Add evaluation notes (likeness, skin, pores...)" value="\${notes.replace(/"/g, '&quot;')}" onblur="saveNotes('\${r.id}', this.value)" />
            </div>

            <details style="font-size:0.75rem;">
              <summary style="cursor:pointer;color:var(--amber);font-weight:600;">Show Full Parameters JSON</summary>
              <pre class="code-box" style="padding:0.75rem;border-radius:8px;margin-top:6px;overflow-x:auto;">\${jsonStr}</pre>
            </details>
          </div>
        \`;
      }).join('');
    }

    async function cancelRun(id) {
      try {
        const res = await labFetch('/api/lab/run/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          loadResults();
        } else {
          alert('Cancel failed: ' + (data.error || 'Unknown'));
        }
      } catch (err) {
        alert('Cancel failed: ' + err.message);
      }
    }

    async function saveRating(id, rating) {
      try {
        const res = await labFetch(\`/api/lab/results/\${encodeURIComponent(id)}/update\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating })
        });
        const data = await res.json();
        if (data.success) {
          const item = currentResults.find(r => r.id === id);
          if (item) item.rating = rating;
          renderResults(currentResults);
        }
      } catch (err) {
        console.warn('Could not save rating:', err);
      }
    }

    async function saveNotes(id, notes) {
      try {
        await labFetch(\`/api/lab/results/\${encodeURIComponent(id)}/update\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        });
        const item = currentResults.find(r => r.id === id);
        if (item) item.notes = notes;
      } catch (err) {
        console.warn('Could not save notes:', err);
      }
    }

    function toggleRealismPanel(id) {
      const panel = document.getElementById('realismPanel-' + id);
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
      }
    }

    async function applyRealismPass(parentId) {
      showError(null);
      const slider = document.getElementById('sigmaSlider-' + parentId);
      const sigma = parseFloat(slider?.value || 2.0);

      try {
        const res = await labFetch('/api/lab/realism-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentRunId: parentId, sigma })
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Realism pass failed.');
        }
        await loadResults();
      } catch (err) {
        showError('Realism Pass Error: ' + err.message);
      }
    }

    async function deleteRun(id) {
      if (!confirm('Delete this test run?')) return;
      try {
        const res = await labFetch('/api/lab/results/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          currentResults = currentResults.filter(r => r.id !== id);
          renderResults(currentResults);
        } else {
          alert('Delete failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    }

    function updateSelectedCount() {
      const all = ['A', 'B', 'C', 'D', 'E', 'F'];
      const selected = all.filter(p => document.getElementById('chkPreset' + p)?.checked);
      document.getElementById('runSelectedLabel').textContent = \`⚡ Run Selected Presets (\${selected.length} of \${all.length} Selected)\`;
    }

    function toggleAllPresets(checked) {
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(p => {
        const chk = document.getElementById('chkPreset' + p);
        if (chk) chk.checked = checked;
      });
      updateSelectedCount();
    }

    async function submitRun(preset, customConfig = null) {
      showError(null);
      const scene = document.getElementById('sceneInput').value;
      const outfit = document.getElementById('outfitInput').value;
      const outputSize = document.getElementById('kontextSizeSelect').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;

      const res = await labFetch('/api/lab/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, mode: currentMode, scene, outfit, outputSize, seed, customConfig })
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Submission failed.');
      }
      return data;
    }

    function setButtonsDisabled(disabled) {
      document.querySelectorAll('.preset-btn, #btnRunSelected, #btnRunCustom').forEach(b => b.disabled = disabled);
    }

    // Run single preset as background job
    async function runPreset(preset) {
      setButtonsDisabled(true);
      showError(null);

      try {
        const data = await submitRun(preset);
        await loadResults();
        startPolling();
      } catch (err) {
        showError('Preset ' + preset + ' Error: ' + err.message);
      } finally {
        setButtonsDisabled(false);
      }
    }

    async function runCustom() {
      setButtonsDisabled(true);
      showError(null);
      const btn = document.getElementById('btnRunCustom');
      btn.textContent = '⏳ Queuing...';

      try {
        const rawJson = document.getElementById('customJsonInput').value;
        const parsed = JSON.parse(rawJson);
        await submitRun('custom', parsed);
        await loadResults();
        startPolling();
      } catch (err) {
        showError('Custom Run Error: ' + err.message);
      } finally {
        btn.textContent = '▶ Run Custom Config';
        setButtonsDisabled(false);
      }
    }

    // Helper: Poll single run until finished (max 185s)
    function pollRunUntilDone(runId, maxWaitMs = 185000) {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const interval = setInterval(async () => {
          if (!isSequenceRunning || Date.now() - startTime > maxWaitMs) {
            clearInterval(interval);
            return resolve({ status: 'timeout' });
          }
          try {
            const res = await labFetch('/api/lab/run/' + encodeURIComponent(runId) + '/status');
            const data = await res.json();
            if (data.success && data.result) {
              const s = data.result.status;
              if (s === 'done' || s === 'error' || s === 'interrupted' || s === 'canceled') {
                clearInterval(interval);
                return resolve(data.result);
              }
            }
          } catch (err) {
            console.warn('Polling error:', err);
          }
        }, 3000);
      });
    }

    // Run All / Selected sequentially with timeout & fault tolerance
    async function runSelectedSequential() {
      const allPresets = [
        { id: 'A', name: 'Preset A (Flux-Pro Kontext)' },
        { id: 'B', name: 'Preset B (PuLID 0.9)' },
        { id: 'C', name: 'Preset C (PuLID 0.8)' },
        { id: 'D', name: 'Preset D (Kontext + Upscale + Grain)' },
        { id: 'E', name: 'Preset E (Nano Banana Edit)' },
        { id: 'F', name: 'Preset F (Seedream Edit)' }
      ];

      const queue = allPresets.filter(p => document.getElementById('chkPreset' + p.id)?.checked);
      if (!queue.length) {
        alert('Please select at least one preset to run.');
        return;
      }

      isSequenceRunning = true;
      setButtonsDisabled(true);
      showError(null);

      const progressText = document.getElementById('runProgressText');
      const progressBar = document.getElementById('progressBar');
      const progressFill = document.getElementById('progressFill');

      progressText.style.display = 'block';
      progressBar.style.display = 'block';

      for (let i = 0; i < queue.length; i++) {
        if (!isSequenceRunning) break;
        const item = queue[i];
        const pct = Math.round((i / queue.length) * 100);
        progressFill.style.width = pct + '%';
        progressText.textContent = \`Running [\${i + 1}/\${queue.length}]: \${item.name}...\`;

        try {
          const runData = await submitRun(item.id);
          const runId = runData.runId;
          await loadResults();
          
          // Poll until this preset completes or errors (180s timeout enforced by backend)
          await pollRunUntilDone(runId, 185000);
          await loadResults();
        } catch (err) {
          // Requirement 4: Continue after any failed preset and show full error card
          console.warn(\`Preset \${item.name} failed:\`, err.message);
          await loadResults();
        }
      }

      progressFill.style.width = '100%';
      progressText.textContent = '✅ All selected tests completed!';
      setTimeout(() => {
        progressText.style.display = 'none';
        progressBar.style.display = 'none';
        progressFill.style.width = '0%';
      }, 5000);

      isSequenceRunning = false;
      setButtonsDisabled(false);
    }

    function populateCustomPreset(preset) {
      const scene = document.getElementById('sceneInput').value;
      const outfit = document.getElementById('outfitInput').value;
      const seed = parseInt(document.getElementById('seedInput').value, 10) || 42;
      let editPrompt = currentMode === 'scene_outfit' && outfit
        ? \`Change the background to \${scene} and change the outfit to \${outfit}. Keep the person's face, hair, pose and expression exactly identical. Natural unretouched photo.\`
        : \`Change only the background to \${scene}. Keep the person's face, hair, outfit, pose and expression exactly identical. Natural unretouched photo.\`;

      let cfg = {};

      if (preset === 'A') {
        cfg = {
          model: 'fal-ai/flux-pro/kontext',
          input: { prompt: editPrompt, seed: seed }
        };
      } else if (preset === 'B') {
        cfg = {
          model: 'fal-ai/flux-pulid',
          input: {
            prompt: scene + (outfit ? ', ' + outfit : '') + ', Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details',
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
            prompt: scene + (outfit ? ', ' + outfit : '') + ', Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details',
            id_weight: 0.8,
            guidance_scale: 2.5,
            start_step: 2,
            true_cfg: 1.0,
            num_inference_steps: 40,
            seed: seed,
            max_sequence_length: '256'
          }
        };
      } else if (preset === 'E') {
        cfg = {
          model: 'fal-ai/nano-banana/edit',
          input: { prompt: editPrompt, num_images: 1, seed: seed }
        };
      } else if (preset === 'F') {
        cfg = {
          model: 'fal-ai/bytedance/seedream/v4.5/edit',
          input: { prompt: editPrompt, num_images: 1, seed: seed }
        };
      }
      document.getElementById('customJsonInput').value = JSON.stringify(cfg, null, 2);
    }

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
    const { mode, scene, outfit, outputSize, seed, lastConfig } = req.body;
    const updated = saveLabState({ mode, scene, outfit, outputSize, seed, lastConfig });
    res.json({ success: true, state: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/upload
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
 * Returns all saved runs sorted newest first
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
 * GET /api/lab/run/:id/status
 * Polled by frontend every 3 seconds for active runs
 */
router.get('/api/lab/run/:id/status', labAuthMiddleware, (req, res) => {
  try {
    const jsonPath = path.join(RESULTS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ success: false, error: 'Run not found' });
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    res.json({ success: true, status: data.status, result: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/run/:id/cancel
 * Cancel an active or queued background job
 */
router.post('/api/lab/run/:id/cancel', labAuthMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const job = activeJobs.get(id);
    if (job) {
      job.isCanceled = true;
      if (job.timeoutId) clearTimeout(job.timeoutId);
      activeJobs.delete(id);
    }

    const updated = updateRunRecord(id, {
      status: 'canceled',
      error: 'Run canceled by user.'
    });

    console.log(`[LAB] Run ${id} canceled.`);
    res.json({ success: true, result: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/results/:id/update
 * Update rating (1-5) and/or notes
 */
router.post('/api/lab/results/:id/update', labAuthMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    const updates = {};
    if (req.body.rating !== undefined) updates.rating = parseInt(req.body.rating, 10) || 0;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    const updated = updateRunRecord(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Run record not found' });
    }
    res.json({ success: true, result: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lab/realism-pass
 * Sharp-only finishing (grain sigma 1.5-2.5, slight contrast lift, no upscaler)
 */
router.post('/api/lab/realism-pass', labAuthMiddleware, async (req, res) => {
  try {
    const { parentRunId, sigma = 2.0 } = req.body;
    const parentJpg = path.join(RESULTS_DIR, `${parentRunId}.jpg`);
    const parentPng = path.join(RESULTS_DIR, `${parentRunId}.png`);

    let parentFilePath = fs.existsSync(parentJpg) ? parentJpg : (fs.existsSync(parentPng) ? parentPng : null);
    if (!parentFilePath) {
      return res.status(404).json({ success: false, error: 'Parent image not found.' });
    }

    console.log(`[LAB REALISM PASS] Applying to ${parentRunId} with sigma ${sigma}...`);
    const parentBuffer = fs.readFileSync(parentFilePath);

    const contrastLifted = await sharp(parentBuffer)
      .linear(1.05, -2)
      .toBuffer();

    const grainBuffer = await applySharpFilmGrain(contrastLifted, parseFloat(sigma));

    const runId = `run_${Date.now()}`;
    const localFileName = `${runId}.jpg`;
    fs.writeFileSync(path.join(RESULTS_DIR, localFileName), grainBuffer);

    let parentSeed = 42;
    try {
      const parentJson = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `${parentRunId}.json`), 'utf8'));
      parentSeed = parentJson.seed || 42;
    } catch {}

    const newRecord = {
      id: runId,
      status: 'done',
      preset: 'realism_pass',
      presetLabel: `Realism Pass (σ=${sigma})`,
      parentRunId,
      model: `sharp-finishing (grain σ=${sigma} + contrast lift)`,
      params: { parentRunId, grain_sigma: sigma, contrast_lift: 1.05 },
      seed: parentSeed,
      runtime: '0.3s',
      cost: 0.000,
      timestamp: new Date().toISOString(),
      imageUrl: `/api/lab/results/${localFileName}`,
      rating: 0,
      notes: `Realism pass applied to run ${parentRunId}`
    };

    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(newRecord, null, 2), 'utf8');
    res.json({ success: true, result: newRecord });
  } catch (err) {
    console.error('[LAB REALISM PASS ERROR]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lab/results/:filename
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
    const job = activeJobs.get(id);
    if (job) {
      job.isCanceled = true;
      if (job.timeoutId) clearTimeout(job.timeoutId);
      activeJobs.delete(id);
    }

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
 * Non-blocking: creates run record, returns runId immediately with status "queued",
 * and processes job asynchronously in detached worker.
 */
router.post('/api/lab/run', labAuthMiddleware, (req, res) => {
  if (!fs.existsSync(ORIGINAL_PHOTO_PATH)) {
    return res.status(400).json({
      success: false,
      error: 'Please upload a reference photo in Step 1 first.'
    });
  }

  const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!falKey || falKey === 'your_fal_api_key_here') {
    return res.status(500).json({
      success: false,
      error: 'FAL_KEY is not configured in .env. Please check your credentials.'
    });
  }

  const { preset, mode, scene, outfit, outputSize, seed, customConfig } = req.body;
  const numSeed = parseInt(seed, 10) || 42;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  let presetLabel = `Preset ${preset}`;
  if (preset === 'A') presetLabel = 'Preset A (Flux-Pro Kontext)';
  else if (preset === 'B') presetLabel = 'Preset B (PuLID 0.9)';
  else if (preset === 'C') presetLabel = 'Preset C (PuLID 0.8 Natural)';
  else if (preset === 'D') presetLabel = 'Preset D (Kontext + Upscale + Grain)';
  else if (preset === 'E') presetLabel = 'Preset E (Nano Banana Edit)';
  else if (preset === 'F') presetLabel = 'Preset F (Seedream Edit)';
  else if (preset === 'custom') presetLabel = 'Custom Run';

  const initialRecord = {
    id: runId,
    status: 'queued',
    preset,
    presetLabel,
    model: preset === 'A' || preset === 'D' ? 'fal-ai/flux-pro/kontext'
      : preset === 'E' ? 'fal-ai/nano-banana/edit'
      : preset === 'F' ? 'fal-ai/bytedance/seedream/v4.5/edit'
      : preset === 'custom' ? (customConfig?.model || 'fal-ai/flux-pulid')
      : 'fal-ai/flux-pulid',
    params: { preset, mode, scene, outfit, outputSize, seed: numSeed },
    seed: numSeed,
    runtime: '0.0s',
    cost: MODEL_PRICING[preset === 'A' || preset === 'D' ? 'fal-ai/flux-pro/kontext' : 'fal-ai/flux-pulid'] || 0.035,
    timestamp: new Date().toISOString(),
    imageUrl: null,
    remoteUrl: null,
    hasOriginal: true,
    rating: 0,
    notes: ''
  };

  fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(initialRecord, null, 2), 'utf8');

  // Immediately respond with queued status and runId
  res.json({
    success: true,
    runId,
    status: 'queued',
    result: initialRecord
  });

  // Launch detached background execution
  processRunJob(runId, {
    preset,
    mode,
    scene,
    outfit,
    outputSize,
    seed: numSeed,
    customConfig,
    falKey
  }).catch(err => {
    console.error(`[LAB BACKGROUND CRASH] ${runId}:`, err);
  });
});

export default router;
