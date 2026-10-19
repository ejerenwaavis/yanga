import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fal } from '@fal-ai/client';
import { 
  uploadReferenceImage, 
  uploadGeneratedImage, 
  getUserGenerations 
} from '../services/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─── PIPELINE CONFIGURATION ──────────────────────────────────────────────────
// Default to 'v2'. Set PIPELINE=legacy in .env to roll back to old PuLID flow.
const PIPELINE = process.env.PIPELINE || 'v2';

// Local storage for temporary generations (kept outside public_html, pruned after 24h)
const GENERATIONS_DIR = path.join(__dirname, '..', 'storage', 'generations');
if (!fs.existsSync(GENERATIONS_DIR)) {
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
}

// ─── 24-HOUR FILE CLEANUP ─────────────────────────────────────────────────────
function cleanupOldGenerations() {
  try {
    if (!fs.existsSync(GENERATIONS_DIR)) return;
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
    const files = fs.readdirSync(GENERATIONS_DIR);
    let deletedCount = 0;
    for (const file of files) {
      const filePath = path.join(GENERATIONS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch {}
    }
    if (deletedCount > 0) {
      console.log(`[CLEANUP] Purged ${deletedCount} production generation files older than 24h.`);
    }
  } catch (err) {
    console.warn('[CLEANUP WARNING]:', err.message);
  }
}
cleanupOldGenerations();
setInterval(cleanupOldGenerations, 60 * 60 * 1000); // Sweep hourly

// ─── RATE LIMITER (10 Generations Per Hour Per IP) ───────────────────────────
const ipRateLimitMap = new Map();
function checkIpRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  let timestamps = ipRateLimitMap.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  if (timestamps.length >= 10) {
    const oldest = timestamps[0];
    const resetSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, resetSec };
  }
  timestamps.push(now);
  ipRateLimitMap.set(ip, timestamps);
  return { allowed: true, remaining: 10 - timestamps.length };
}

// ─── DUPLICATE REQUEST GUARD (10s Window) ───────────────────────────────────
const recentRequests = new Map();

// ─── BACKGROUND JOBS STORE ───────────────────────────────────────────────────
const jobsStore = new Map();

function updateJobRecord(jobId, updates) {
  const current = jobsStore.get(jobId) || {};
  const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
  jobsStore.set(jobId, updated);
  try {
    const jsonPath = path.join(GENERATIONS_DIR, `${jobId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');
  } catch {}
  return updated;
}

function getJobRecord(jobId) {
  if (jobsStore.has(jobId)) {
    return jobsStore.get(jobId);
  }
  try {
    const jsonPath = path.join(GENERATIONS_DIR, `${jobId}.json`);
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      jobsStore.set(jobId, data);
      return data;
    }
  } catch {}
  return null;
}

// ─── MULTER CONFIGURATION (jpeg, png, webp up to 10MB) ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid image format. Only JPEG, PNG, and WebP images up to 10MB are supported.'));
    }
    cb(null, true);
  }
});

// ─── CANONICAL PROMPT COMPOSER (PIPELINE V2) ─────────────────────────────────
/**
 * REQUIREMENT 9:
 * Build the prompt as:
 * "Edit this photo: {instruction}. Keep the person's face, skin tone, facial features,
 * expression and body proportions exactly identical to the photo[, plus the enabled locks:
 * same outfit / same pose / same hair / same props and objects / same background].
 * If my request conflicts with a keep rule, follow my request. No readable text,
 * signs or logos in the background. Clean sky with no stray shapes. Natural unretouched photo."
 */
export function buildV2Prompt(instruction, locks = {}) {
  const cleanInstruction = (instruction || '').trim();
  const lockPhrases = [];
  if (locks.outfit) lockPhrases.push('same outfit');
  if (locks.pose) lockPhrases.push('same pose');
  if (locks.hair) lockPhrases.push('same hair');
  if (locks.props) lockPhrases.push('same props and objects');
  if (locks.background) lockPhrases.push('same background');

  const locksPart = lockPhrases.length > 0 ? `, ${lockPhrases.join(', ')}` : '';
  return `Edit this photo: ${cleanInstruction}. Keep the person's face, skin tone, facial features, expression and body proportions exactly identical to the photo${locksPart}. If my request conflicts with a keep rule, follow my request. No readable text, signs or logos in the background. Clean sky with no stray shapes. Natural unretouched photo.`;
}

// ─── LEGACY PULID CONSTANTS ──────────────────────────────────────────────────
const LEGACY_REALISM_SUFFIX = "Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.";
const LEGACY_NEGATIVE_PROMPT = "plastic skin, airbrushed, cartoon, CGI, 3D render, oversaturated, deformed face, bad anatomy, blur, bad eyes, extra limbs";

function mapLegacyAspectRatio(ratioKey) {
  switch (ratioKey) {
    case 'ig_feed_4_5':
      return { width: 1080, height: 1350 };
    case 'story_9_16':
      return { width: 1080, height: 1920 };
    case 'square_hd':
      return { width: 1080, height: 1080 };
    default:
      return { width: 1080, height: 1350 };
  }
}

// ─── PIPELINE V2 WORKER (Nano Banana Edit -> SeedVR2 2x Upscale) ─────────────
async function runPipelineV2Worker(jobId, jobParams) {
  const { fileBuffer, instruction, locks, userId } = jobParams;
  const startTime = Date.now();

  console.log(`[PIPELINE V2] Starting background worker for job ${jobId}...`);
  updateJobRecord(jobId, { status: 'running', stage: 'initializing' });

  // 180s Timeout Guard
  const timeoutTimer = setTimeout(() => {
    const job = getJobRecord(jobId);
    if (job && job.status === 'running') {
      console.error(`[PIPELINE V2] Job ${jobId} timed out after 180s.`);
      updateJobRecord(jobId, {
        status: 'error',
        stage: 'failed',
        error: 'Photoshoot generation timed out after 180 seconds. Please try again.',
        runtime: '180.0s'
      });
    }
  }, 180000);

  try {
    const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!falKey) {
      throw new Error('FAL_KEY is not configured in server environment.');
    }
    fal.config({ credentials: falKey });

    // STEP 1: Resize photo with sharp to max 2048px on the long side while preserving ratio
    console.log(`[PIPELINE V2] Resizing reference photo with sharp (max 2048px)...`);
    const resizedBuffer = await sharp(fileBuffer)
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    const resizedMeta = await sharp(resizedBuffer).metadata();
    const origW = resizedMeta.width;
    const origH = resizedMeta.height;

    // Upload to Fal CDN
    console.log(`[PIPELINE V2] Uploading resized reference to Fal storage (${origW}x${origH})...`);
    const photoBlob = new Blob([resizedBuffer], { type: 'image/jpeg' });
    const uploadedUrl = await fal.storage.upload(photoBlob);

    // Backup reference to Cloudinary in background for user history
    uploadReferenceImage(resizedBuffer, 'image/jpeg', { userId }).catch((e) =>
      console.warn('[CLOUDINARY NOTICE] Reference upload skipped:', e.message)
    );

    // STEP 2: Build Canonical V2 Prompt & Run fal-ai/nano-banana/edit
    updateJobRecord(jobId, { stage: 'editing_background' });
    const editPrompt = buildV2Prompt(instruction, locks);
    console.log(`[PIPELINE V2] Executing fal-ai/nano-banana/edit for job ${jobId}...`);
    console.log(`[PIPELINE V2 PROMPT] "${editPrompt}"`);

    const editResult = await fal.subscribe('fal-ai/nano-banana/edit', {
      input: {
        prompt: editPrompt,
        image_urls: [uploadedUrl],
        image_url: uploadedUrl,
        num_images: 1
      }
    });

    const step2ImageUrl =
      editResult.data?.images?.[0]?.url ||
      editResult.data?.image?.url ||
      editResult.images?.[0]?.url ||
      editResult.image?.url;

    if (!step2ImageUrl) {
      throw new Error('fal-ai/nano-banana/edit returned no image URL: ' + JSON.stringify(editResult));
    }

    let finalImageUrl = step2ImageUrl;
    let isUpscaled = false;
    let upscaleCost = 0.000;
    const editCost = 0.039; // Nano Banana standard edit cost

    // STEP 3: Upscale with fal-ai/seedvr/upscale/image at 2x (non-generative, no grain, no sharpening)
    updateJobRecord(jobId, { stage: 'upscaling_2x' });
    console.log(`[PIPELINE V2] Running SeedVR2 2x upscale...`);
    try {
      const upResult = await fal.subscribe('fal-ai/seedvr/upscale/image', {
        input: {
          image_url: step2ImageUrl,
          upscale_mode: 'factor',
          factor: 2
        }
      });
      const upscaledUrl =
        upResult.data?.image?.url ||
        upResult.data?.images?.[0]?.url ||
        upResult.image?.url ||
        upResult.images?.[0]?.url;

      if (upscaledUrl) {
        finalImageUrl = upscaledUrl;
        isUpscaled = true;
        upscaleCost = 0.005; // SeedVR2 2x pricing
        console.log(`[PIPELINE V2] SeedVR2 2x upscale completed successfully.`);
      }
    } catch (upErr) {
      console.warn(`[PIPELINE V2 NOTICE] SeedVR2 upscale failed, falling back to step 2 result:`, upErr.message);
      isUpscaled = false;
    }

    // Download final image buffer to measure exact dimensions and cache locally
    const imgRes = await fetch(finalImageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download output image: ${imgRes.statusText}`);
    const finalBuffer = Buffer.from(await imgRes.arrayBuffer());
    const finalMeta = await sharp(finalBuffer).metadata();
    const finalW = finalMeta.width || (isUpscaled ? origW * 2 : origW);
    const finalH = finalMeta.height || (isUpscaled ? origH * 2 : origH);

    // Save temporary copy for 24h caching
    const localFileName = `${jobId}.jpg`;
    fs.writeFileSync(path.join(GENERATIONS_DIR, localFileName), finalBuffer);

    // Cost & Runtime Logging
    const totalCost = editCost + upscaleCost;
    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';
    console.log(`[GENERATE COST] Job ${jobId} finished in ${runtimeStr}. Total: $${totalCost.toFixed(3)} (nano-banana: $${editCost.toFixed(3)}, seedvr: $${upscaleCost.toFixed(3)})`);

    // Backup generation to Cloudinary vault in background
    let persistentUrl = null;
    try {
      const cloudRes = await uploadGeneratedImage(finalImageUrl, {
        userId,
        prompt: instruction
      });
      persistentUrl = cloudRes.secureUrl;
    } catch (cErr) {
      console.warn('[CLOUDINARY NOTICE] Generation backup skipped:', cErr.message);
    }

    // Mark Job Done — REQUIREMENT 11: Save final prompt, instruction, and locks in run's JSON and logs
    clearTimeout(timeoutTimer);
    updateJobRecord(jobId, {
      status: 'done',
      stage: 'complete',
      runtime: runtimeStr,
      cost: totalCost,
      instruction,
      locks,
      prompt: editPrompt,
      result: {
        success: true,
        jobId,
        imageUrl: persistentUrl || finalImageUrl,
        width: finalW,
        height: finalH,
        upscaled: isUpscaled,
        seed: editResult.data?.seed || editResult.seed || 42,
        cost: totalCost,
        instruction,
        locks,
        prompt: editPrompt,
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    clearTimeout(timeoutTimer);
    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';
    const errorMsg = err?.body?.detail || err?.message || String(err);
    console.error(`[PIPELINE V2 ERROR] Job ${jobId} failed after ${runtimeStr}:`, errorMsg);
    updateJobRecord(jobId, {
      status: 'error',
      stage: 'failed',
      error: errorMsg,
      runtime: runtimeStr,
      instruction,
      locks
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    const userId = req.user?.userId || req.body?.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded. Please upload a clear photo.' });
    }

    // REQUIREMENT 7 & 8: Accept only { instruction, locks } plus the image.
    // Block empty instruction: "Describe the scene or change you want."
    const instruction = (req.body.instruction || req.body.prompt || '').trim();
    if (!instruction) {
      return res.status(400).json({
        success: false,
        error: 'Describe the scene or change you want.'
      });
    }

    // Parse and normalize locks (Defaults: outfit=true, pose=true, hair=true, props=true, background=false)
    let rawLocks = req.body.locks;
    if (typeof rawLocks === 'string') {
      try {
        rawLocks = JSON.parse(rawLocks);
      } catch {
        rawLocks = {};
      }
    }
    rawLocks = rawLocks || {};
    const effectiveLocks = {
      outfit: rawLocks.outfit !== false && rawLocks.outfit !== 'false',
      pose: rawLocks.pose !== false && rawLocks.pose !== 'false',
      hair: rawLocks.hair !== false && rawLocks.hair !== 'false',
      props: rawLocks.props !== false && rawLocks.props !== 'false',
      background: rawLocks.background === true || rawLocks.background === 'true'
    };

    // REQUIREMENT 6: Rate limit check (10 generations per hour per IP)
    const rateCheck = checkIpRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded: You have reached the maximum of 10 photoshoots per hour. Please try again in ${Math.ceil(rateCheck.resetSec / 60)} minutes.`
      });
    }

    // REQUIREMENT 4: Duplicate request guard (10 seconds)
    const dedupKey = `${clientIp}_${userId || ''}_${instruction}_${JSON.stringify(effectiveLocks)}`;
    const lastRequestTime = recentRequests.get(dedupKey);
    if (lastRequestTime && (Date.now() - lastRequestTime < 10000)) {
      return res.status(429).json({
        success: false,
        error: 'Duplicate photoshoot request ignored. Please wait a few seconds before trying again.'
      });
    }
    recentRequests.set(dedupKey, Date.now());

    // ─── LEGACY PULID PIPELINE (PIPELINE=legacy) ───────────────────────────
    if (PIPELINE === 'legacy') {
      console.log(`[PIPELINE LEGACY] Running fallback PuLID pipeline for user ${userId || 'anonymous'}...`);
      const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
      if (!falKey) {
        return res.status(500).json({ success: false, error: 'FAL_KEY is not configured in .env.' });
      }
      fal.config({ credentials: falKey });

      const base64Image = req.file.buffer.toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;
      const finalPrompt = instruction ? `${instruction}, ${LEGACY_REALISM_SUFFIX}` : LEGACY_REALISM_SUFFIX;
      const imageSize = mapLegacyAspectRatio(req.body.aspect_ratio);

      const result = await fal.subscribe('fal-ai/flux-pulid', {
        input: {
          prompt: finalPrompt,
          reference_image_url: dataURI,
          image_size: imageSize,
          num_inference_steps: 28,
          guidance_scale: parseFloat(req.body.guidance_scale || 3.5),
          true_cfg: parseFloat(req.body.true_cfg || 1.3),
          negative_prompt: LEGACY_NEGATIVE_PROMPT,
          id_weight: parseFloat(req.body.id_weight || 1.0),
          start_step: parseInt(req.body.start_step ?? 1, 10),
          enable_safety_checker: true
        }
      });

      const rawImageUrl = result.data?.images?.[0]?.url || result.images?.[0]?.url;
      if (!rawImageUrl) throw new Error('No image URL returned from FAL model.');

      let persistentGeneration = null;
      try {
        persistentGeneration = await uploadGeneratedImage(rawImageUrl, { userId, prompt: instruction });
      } catch {}

      return res.json({
        success: true,
        imageUrl: persistentGeneration?.secureUrl || rawImageUrl,
        seed: result.data?.seed || result.seed,
        width: 1080,
        height: 1350
      });
    }

    // ─── PIPELINE V2 (Default Winning Pipeline) ────────────────────────────
    const jobId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const finalPrompt = buildV2Prompt(instruction, effectiveLocks);

    const initialJob = {
      jobId,
      status: 'queued',
      stage: 'queued',
      userId,
      instruction,
      locks: effectiveLocks,
      prompt: finalPrompt,
      createdAt: new Date().toISOString()
    };

    updateJobRecord(jobId, initialJob);

    // Launch background worker detached from request
    runPipelineV2Worker(jobId, {
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
      instruction,
      locks: effectiveLocks,
      userId
    });

    // Return jobId immediately with status "queued"
    return res.json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Photoshoot job queued successfully. Poll /api/generate/status/:jobId for updates.'
    });

  } catch (error) {
    console.error('[GENERATE CONTROLLER ERROR]:', error);
    res.status(500).json({ success: false, error: error.message || 'An unexpected error occurred.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/generate/status/:jobId & GET /api/generate/:jobId
// Pollable status endpoint (polls every 3s from UI)
// ─────────────────────────────────────────────────────────────────────────────
const handleJobStatus = (req, res) => {
  const jobId = req.params.jobId || req.params.id;
  const job = getJobRecord(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Photoshoot job not found.' });
  }

  if (job.status === 'done') {
    return res.json({
      success: true,
      status: 'done',
      stage: 'complete',
      result: job.result
    });
  }

  if (job.status === 'error') {
    return res.json({
      success: false,
      status: 'error',
      stage: 'failed',
      error: job.error || 'Generation failed.'
    });
  }

  return res.json({
    success: true,
    status: job.status,
    stage: job.stage || 'processing',
    runtime: job.runtime || null
  });
};

router.get('/status/:jobId', handleJobStatus);
router.get('/:jobId', handleJobStatus);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/generate/history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const userId = req.user?.userId || req.query.userId;
    if (!userId) {
      return res.json({ success: true, history: [] });
    }
    const history = await getUserGenerations(userId);
    res.json({ success: true, history });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
