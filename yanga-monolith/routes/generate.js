import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
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

// Local storage for temporary generations & originals (pruned after 7 days)
const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const GENERATIONS_DIR = path.join(STORAGE_DIR, 'generations');
const ORIGINALS_DIR = path.join(STORAGE_DIR, 'originals');

if (!fs.existsSync(GENERATIONS_DIR)) {
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
}
if (!fs.existsSync(ORIGINALS_DIR)) {
  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
}

// ─── 7-DAY RETENTION FILE CLEANUP (ORIGINALS & OUTPUTS) ───────────────────────
function cleanupOldGenerations() {
  try {
    const now = Date.now();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days (updated from 24h)

    const cleanDir = (dir) => {
      if (!fs.existsSync(dir)) return 0;
      const files = fs.readdirSync(dir);
      let count = 0;
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            count++;
          }
        } catch {}
      }
      return count;
    };

    const genPurged = cleanDir(GENERATIONS_DIR);
    const origPurged = cleanDir(ORIGINALS_DIR);
    if (genPurged > 0 || origPurged > 0) {
      console.log(`[CLEANUP] Purged ${genPurged} generations and ${origPurged} originals older than 7 days.`);
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

export function generatePhotoFilename(sceneOrInstruction, version = 1) {
  let slug = 'photo';
  if (sceneOrInstruction) {
    slug = sceneOrInstruction
      .toLowerCase()
      .replace(/^place me (in|on|at|along)\s+/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '');
  }
  if (!slug) slug = 'photo';
  const timestamp = Date.now();
  return `${slug}-${timestamp}-v${version}.jpg`;
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
  const { 
    fileBuffer, 
    instruction, 
    locks, 
    userId, 
    parentId, 
    baseUsed, 
    version, 
    sceneSlug, 
    originalFileName, 
    originalUrl 
  } = jobParams;
  const startTime = Date.now();

  console.log(`[PIPELINE V2] Starting background worker for job ${jobId} (v${version || 1}, base: ${baseUsed || 'original'})...`);
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

    // STEP 1: Downscale input photo with sharp to max 2048px on the long side while preserving ratio
    console.log(`[PIPELINE V2] Downscaling input photo with sharp (max 2048px)...`);
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
    console.log(`[PIPELINE V2] Uploading resized input to Fal storage (${origW}x${origH})...`);
    const photoBlob = new Blob([resizedBuffer], { type: 'image/jpeg' });
    const uploadedUrl = await fal.storage.upload(photoBlob);

    // Backup reference to Cloudinary in background for user history (if fresh upload)
    if (!parentId) {
      uploadReferenceImage(resizedBuffer, 'image/jpeg', { userId }).catch((e) =>
        console.warn('[CLOUDINARY NOTICE] Reference upload skipped:', e.message)
      );
    }

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

    // Save image locally with standard filename format: {scene-slug}-{timestamp}-v{n}.jpg
    const finalFileName = generatePhotoFilename(sceneSlug || instruction, version || 1);
    fs.writeFileSync(path.join(GENERATIONS_DIR, finalFileName), finalBuffer);
    // Keep jobId.jpg alias for backward-compatible lookups
    fs.writeFileSync(path.join(GENERATIONS_DIR, `${jobId}.jpg`), finalBuffer);

    // Cost & Runtime Logging
    const totalCost = editCost + upscaleCost;
    const runtimeMs = Date.now() - startTime;
    const runtimeStr = (runtimeMs / 1000).toFixed(1) + 's';
    console.log(`[GENERATE COST] Job ${jobId} (${finalFileName}) finished in ${runtimeStr}. Total: $${totalCost.toFixed(3)} (nano-banana: $${editCost.toFixed(3)}, seedvr: $${upscaleCost.toFixed(3)})`);

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

    // Mark Job Done — Store parentId, baseUsed, version, instruction, locks, and file names
    clearTimeout(timeoutTimer);
    const resolvedResultUrl = persistentUrl || `/api/generate/image/${finalFileName}`;
    const resolvedOriginalUrl = originalUrl || (originalFileName ? `/api/generate/original/${originalFileName}` : null);

    const resultObj = {
      success: true,
      jobId,
      imageUrl: resolvedResultUrl,
      originalUrl: resolvedOriginalUrl,
      filename: finalFileName,
      localFileName: finalFileName,
      originalFileName: originalFileName || null,
      parentId: parentId || null,
      baseUsed: baseUsed || 'original',
      version: version || 1,
      sceneSlug: sceneSlug || 'photo',
      width: finalW,
      height: finalH,
      upscaled: isUpscaled,
      seed: editResult.data?.seed || editResult.seed || 42,
      cost: totalCost,
      instruction,
      locks,
      prompt: editPrompt,
      createdAt: new Date().toISOString()
    };

    updateJobRecord(jobId, {
      status: 'done',
      stage: 'complete',
      runtime: runtimeStr,
      cost: totalCost,
      instruction,
      locks,
      prompt: editPrompt,
      parentId: parentId || null,
      baseUsed: baseUsed || 'original',
      version: version || 1,
      filename: finalFileName,
      localFileName: finalFileName,
      originalFileName: originalFileName || null,
      originalUrl: resolvedOriginalUrl,
      result: resultObj
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
      locks,
      parentId: parentId || null,
      baseUsed: baseUsed || 'original',
      version: version || 1
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate
// Handles both fresh photoshoot runs and edits of existing generated images
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    const userId = req.user?.userId || req.body?.userId;

    // REQUIREMENT 1: Accept instruction (single source of truth)
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

    // REQUIREMENT 3: Support editing generated images (parentId + baseUsed)
    const parentId = (req.body.parentId || '').trim() || null;
    let baseUsed = (req.body.baseUsed || '').trim().toLowerCase();
    if (!baseUsed) {
      baseUsed = parentId ? 'result' : 'original';
    } else if (baseUsed === 'this_result') {
      baseUsed = 'result';
    }

    const sceneSlug = (req.body.sceneSlug || '').trim() || null;
    const jobId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let inputBuffer = null;
    let originalFileName = null;
    let originalUrl = null;
    let version = 1;

    if (parentId) {
      const parentJob = getJobRecord(parentId);
      if (!parentJob) {
        return res.status(404).json({ success: false, error: 'Parent photoshoot not found.' });
      }

      version = (parentJob.version || 1) + 1;
      originalFileName = parentJob.originalFileName || `${parentId}-orig.jpg`;
      originalUrl = parentJob.originalUrl || `/api/generate/original/${originalFileName}`;

      if (baseUsed === 'result') {
        const parentResultPath = path.join(GENERATIONS_DIR, parentJob.localFileName || `${parentId}.jpg`);
        if (fs.existsSync(parentResultPath)) {
          inputBuffer = fs.readFileSync(parentResultPath);
        } else if (parentJob.imageUrl || parentJob.result?.imageUrl) {
          try {
            const fetchRes = await fetch(parentJob.imageUrl || parentJob.result.imageUrl);
            if (fetchRes.ok) inputBuffer = Buffer.from(await fetchRes.arrayBuffer());
          } catch {}
        } else if (req.file) {
          inputBuffer = req.file.buffer;
        }

        if (!inputBuffer) {
          return res.status(400).json({
            success: false,
            error: 'The base photoshoot result has expired or is unavailable on disk.'
          });
        }
      } else {
        // baseUsed === 'original'
        const parentOrigPath = path.join(ORIGINALS_DIR, originalFileName);
        if (fs.existsSync(parentOrigPath)) {
          inputBuffer = fs.readFileSync(parentOrigPath);
        } else if (parentJob.originalUrl || parentJob.result?.originalUrl) {
          try {
            const fetchRes = await fetch(parentJob.originalUrl || parentJob.result.originalUrl);
            if (fetchRes.ok) inputBuffer = Buffer.from(await fetchRes.arrayBuffer());
          } catch {}
        } else if (req.file) {
          inputBuffer = req.file.buffer;
        }

        if (!inputBuffer) {
          return res.status(400).json({
            success: false,
            error: 'The original reference photo has expired. Please upload a new photo.'
          });
        }
      }
    } else {
      // Fresh new photoshoot
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image uploaded. Please upload a clear photo.' });
      }
      inputBuffer = req.file.buffer;
      originalFileName = `${jobId}-orig.jpg`;
      originalUrl = `/api/generate/original/${originalFileName}`;
      try {
        fs.writeFileSync(path.join(ORIGINALS_DIR, originalFileName), inputBuffer);
      } catch (writeErr) {
        console.warn('[STORAGE] Could not write original photo:', writeErr.message);
      }
    }

    // Rate limit check (10 generations per hour per IP)
    const rateCheck = checkIpRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded: You have reached the maximum of 10 photoshoots per hour. Please try again in ${Math.ceil(rateCheck.resetSec / 60)} minutes.`
      });
    }

    // Duplicate request guard (10 seconds)
    const dedupKey = `${clientIp}_${userId || ''}_${instruction}_${JSON.stringify(effectiveLocks)}_${parentId || ''}_${baseUsed}`;
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

      const base64Image = inputBuffer.toString('base64');
      const dataURI = `data:image/jpeg;base64,${base64Image}`;
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
    const finalPrompt = buildV2Prompt(instruction, effectiveLocks);

    const initialJob = {
      jobId,
      status: 'queued',
      stage: 'queued',
      userId,
      instruction,
      locks: effectiveLocks,
      prompt: finalPrompt,
      parentId,
      baseUsed,
      version,
      originalFileName,
      originalUrl,
      createdAt: new Date().toISOString()
    };

    updateJobRecord(jobId, initialJob);

    // Launch background worker detached from request
    runPipelineV2Worker(jobId, {
      fileBuffer: inputBuffer,
      instruction,
      locks: effectiveLocks,
      userId,
      parentId,
      baseUsed,
      version,
      sceneSlug,
      originalFileName,
      originalUrl
    });

    // Return jobId immediately with status "queued"
    return res.json({
      success: true,
      jobId,
      status: 'queued',
      version,
      parentId,
      baseUsed,
      message: 'Photoshoot job queued successfully. Poll /api/generate/status/:jobId for updates.'
    });

  } catch (error) {
    console.error('[GENERATE CONTROLLER ERROR]:', error);
    res.status(500).json({ success: false, error: error.message || 'An unexpected error occurred.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVE GENERATED OUTPUT IMAGES
// ─────────────────────────────────────────────────────────────────────────────
router.get('/image/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(GENERATIONS_DIR, safeName);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(filePath);
  }
  return res.status(404).send('Image not found or expired.');
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVE ORIGINAL REFERENCE PHOTOS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/original/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  let filePath = path.join(ORIGINALS_DIR, safeName);
  if (!fs.existsSync(filePath) && !safeName.endsWith('.jpg')) {
    filePath = path.join(ORIGINALS_DIR, `${safeName}.jpg`);
  }
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(filePath);
  }
  return res.status(404).send('Original photo not found or expired.');
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-SELECT & BATCH ZIP DOWNLOAD (STREAMED VIA ARCHIVER)
// User-scoped, authenticated zip archive: yanga-photos-YYYYMMDD.zip
// ─────────────────────────────────────────────────────────────────────────────
router.post('/download-zip', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const { jobIds, includeOriginals, all } = req.body;

    // Collect user-scoped jobs
    const userJobMap = new Map();
    for (const [id, job] of jobsStore.entries()) {
      if (job.userId === userId && job.status === 'done') {
        userJobMap.set(id, job);
      }
    }

    // Also scan GENERATIONS_DIR for JSONs
    try {
      const files = fs.readdirSync(GENERATIONS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = JSON.parse(fs.readFileSync(path.join(GENERATIONS_DIR, file), 'utf8'));
          if (data.userId === userId && data.status === 'done' && !userJobMap.has(data.jobId)) {
            userJobMap.set(data.jobId, data);
          }
        }
      }
    } catch {}

    let targetJobs = [];
    if (all) {
      targetJobs = Array.from(userJobMap.values());
    } else if (Array.isArray(jobIds) && jobIds.length > 0) {
      targetJobs = jobIds
        .map(id => userJobMap.get(id))
        .filter(Boolean);
    }

    if (targetJobs.length === 0) {
      return res.status(404).json({ success: false, error: 'No photos found to download.' });
    }

    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const zipName = `yanga-photos-${yyyymmdd}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[ZIP ARCHIVER ERROR]', err);
      if (!res.headersSent) res.status(500).send('Failed to build zip archive.');
    });

    archive.pipe(res);

    const addedEntries = new Set();

    for (const job of targetJobs) {
      const resultFileName = job.filename || job.localFileName || `${job.jobId}.jpg`;
      const localResultPath = path.join(GENERATIONS_DIR, job.localFileName || resultFileName);

      if (fs.existsSync(localResultPath) && !addedEntries.has(resultFileName)) {
        archive.file(localResultPath, { name: resultFileName });
        addedEntries.add(resultFileName);
      } else if (job.result?.imageUrl || job.imageUrl) {
        try {
          const fetchRes = await fetch(job.result?.imageUrl || job.imageUrl);
          if (fetchRes.ok) {
            const buf = Buffer.from(await fetchRes.arrayBuffer());
            archive.append(buf, { name: resultFileName });
            addedEntries.add(resultFileName);
          }
        } catch {}
      }

      // If user selected "Include originals"
      if (includeOriginals) {
        const origFileName = job.originalFileName || `${job.jobId}-orig.jpg`;
        const localOrigPath = path.join(ORIGINALS_DIR, origFileName);
        const inZipOrigName = `originals/${resultFileName.replace(/\.jpg$/i, '')}-original.jpg`;

        if (fs.existsSync(localOrigPath) && !addedEntries.has(inZipOrigName)) {
          archive.file(localOrigPath, { name: inZipOrigName });
          addedEntries.add(inZipOrigName);
        } else if (job.originalUrl || job.result?.originalUrl) {
          try {
            const fetchRes = await fetch(job.originalUrl || job.result?.originalUrl);
            if (fetchRes.ok) {
              const buf = Buffer.from(await fetchRes.arrayBuffer());
              archive.append(buf, { name: inZipOrigName });
              addedEntries.add(inZipOrigName);
            }
          } catch {}
        }
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('[ZIP DOWNLOAD CRASH]', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT USER PURGE: "Delete my photos now"
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/my-photos', async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    let deletedCount = 0;

    // Purge memory store
    for (const [id, job] of jobsStore.entries()) {
      if (job.userId === userId) {
        jobsStore.delete(id);
      }
    }

    // Purge files from disk
    if (fs.existsSync(GENERATIONS_DIR)) {
      const files = fs.readdirSync(GENERATIONS_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const jsonPath = path.join(GENERATIONS_DIR, file);
            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (data.userId === userId) {
              // Remove generation files
              if (data.localFileName) {
                const imgPath = path.join(GENERATIONS_DIR, data.localFileName);
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
              }
              const defaultImg = path.join(GENERATIONS_DIR, `${data.jobId}.jpg`);
              if (fs.existsSync(defaultImg)) fs.unlinkSync(defaultImg);

              // Remove original files
              if (data.originalFileName) {
                const origPath = path.join(ORIGINALS_DIR, data.originalFileName);
                if (fs.existsSync(origPath)) fs.unlinkSync(origPath);
              }
              const defaultOrig = path.join(ORIGINALS_DIR, `${data.jobId}-orig.jpg`);
              if (fs.existsSync(defaultOrig)) fs.unlinkSync(defaultOrig);

              // Remove json
              fs.unlinkSync(jsonPath);
              deletedCount++;
            }
          } catch {}
        }
      }
    }

    console.log(`[USER PURGE] Successfully wiped ${deletedCount} records & photos for user ${userId}.`);
    return res.json({
      success: true,
      count: deletedCount,
      message: 'All your photos and history have been permanently deleted from disk.'
    });
  } catch (err) {
    console.error('[USER PURGE ERROR]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SINGLE PHOTO
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:jobId', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { jobId } = req.params;
    const job = getJobRecord(jobId);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Photo not found.' });
    }
    if (job.userId && job.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized to delete this photo.' });
    }

    jobsStore.delete(jobId);

    const jsonPath = path.join(GENERATIONS_DIR, `${jobId}.json`);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

    if (job.localFileName) {
      const imgPath = path.join(GENERATIONS_DIR, job.localFileName);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    const defaultImg = path.join(GENERATIONS_DIR, `${jobId}.jpg`);
    if (fs.existsSync(defaultImg)) fs.unlinkSync(defaultImg);

    return res.json({ success: true, message: 'Photo deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/generate/status/:jobId & GET /api/generate/:jobId
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
