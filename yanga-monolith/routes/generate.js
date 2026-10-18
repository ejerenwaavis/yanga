import express from 'express';
import multer from 'multer';
import { fal } from '@fal-ai/client';
import { 
  uploadReferenceImage, 
  uploadGeneratedImage, 
  getUserGenerations 
} from '../services/cloudinary.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Camera physics & optical realism engine prompts
const REALISM_SUFFIX = "Shot on Canon EOS R5 with 85mm f/1.4L lens, raw unretouched editorial photography, authentic natural skin texture with visible pores and subtle skin micro-details, natural subsurface scattering, true-to-life dynamic range, natural shadow falloff, subtle Kodak Portra 400 film grain, zero airbrushing.";

const NEGATIVE_PROMPT = "plastic skin, waxy skin, airbrushed, smooth skin filter, CGI, 3d render, illustration, painting, cartoon, anime, oversaturated, neon lighting, distorted facial features, asymmetrical eyes, blurry, low resolution, watermark, text";

/**
 * Aspect Ratio Lookup Helper
 */
function mapAspectRatio(ratio) {
  switch (ratio) {
    case 'ig_feed_4_5':
      return { width: 1080, height: 1350 };
    case 'story_9_16':
      return 'portrait_16_9';
    case 'square_hd':
      return 'square_hd';
    default:
      return 'portrait_4_3';
  }
}

/**
 * POST /api/generate
 * Upgraded with optical realism engine, camera physics, and Cloudinary persistence
 */
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body;
    const userId = req.user?.userId || req.body?.userId;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    // 1. Initialize and verify Fal API credentials
    const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!falKey || falKey === 'your_fal_api_key_here') {
      return res.status(500).json({ 
        success: false, 
        error: 'FAL_KEY is not configured in .env. Please add your Fal API key.' 
      });
    }

    fal.config({ credentials: falKey });

    // 2. Prepare reference image (Base64 Data URI) and backup to Cloudinary
    const base64Image = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;

    let referenceUpload = null;
    try {
      referenceUpload = await uploadReferenceImage(req.file.buffer, req.file.mimetype, { userId });
      console.log('Reference saved to Cloudinary:', referenceUpload.publicId);
    } catch (cErr) {
      console.warn('Notice: Cloudinary reference upload fallback:', cErr.message);
    }

    // 3. Compose combined optical realism prompt
    const basePrompt = (prompt || '').trim();
    const finalPrompt = basePrompt ? `${basePrompt}, ${REALISM_SUFFIX}` : REALISM_SUFFIX;

    // 4. Map aspect ratio
    const imageSize = mapAspectRatio(req.body.aspect_ratio);

    // 5. Execute FLUX + PuLID model with camera physics parameters
    const result = await fal.subscribe('fal-ai/flux-pulid', {
      input: {
        prompt: finalPrompt,
        reference_image_url: dataURI,
        image_size: imageSize,
        num_inference_steps: 28,
        guidance_scale: parseFloat(req.body.guidance_scale || 3.5),
        true_cfg: parseFloat(req.body.true_cfg || 1.3),
        negative_prompt: NEGATIVE_PROMPT,
        id_weight: parseFloat(req.body.id_weight || 1.0),
        start_step: parseInt(req.body.start_step ?? 1, 10),
        enable_safety_checker: true
      }
    });

    // 6. Safely extract output image URL and seed
    const images = result.data?.images || result.images;
    const rawImageUrl = images?.[0]?.url;
    const seed = result.data?.seed || result.seed;

    if (!rawImageUrl) {
      throw new Error('No image URL returned from FAL model.');
    }

    // 7. Save generation to Cloudinary yanga-generations/<userId>
    let persistentGeneration = null;
    try {
      persistentGeneration = await uploadGeneratedImage(rawImageUrl, {
        userId,
        prompt: basePrompt,
        referenceUrl: referenceUpload?.secureUrl
      });
      console.log('Generation saved to Cloudinary:', persistentGeneration.publicId);
    } catch (saveErr) {
      console.error('Notice: Could not save generation to Cloudinary:', saveErr.message);
    }

    res.json({ 
      success: true, 
      imageUrl: persistentGeneration?.secureUrl || rawImageUrl,
      seed: seed,
      referenceUrl: referenceUpload?.secureUrl || null,
      publicId: persistentGeneration?.publicId || null,
      createdAt: persistentGeneration?.createdAt || new Date().toISOString()
    });
  } catch (error) {
    console.error('Generation Error:', error);
    const errorMessage = error?.body?.detail || error?.message || 'An unexpected error occurred during generation.';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/generate/history?userId=...
 * Retrieves the user's saved generations from Cloudinary (yanga-generations/<userId>)
 */
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
