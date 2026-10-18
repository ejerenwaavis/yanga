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

/**
 * POST /api/generate
 * Handles uploading reference image to Cloudinary (yanga-uploads),
 * generating AI photoshoot via Fal FLUX + PuLID,
 * and saving the generated photoshoot to Cloudinary (yanga-generations).
 */
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body;
    const userId = req.user?.userId || req.body?.userId;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image uploaded' });
    }

    const falKey = (process.env.FAL_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!falKey || falKey === 'your_fal_api_key_here') {
      return res.status(500).json({ 
        success: false, 
        error: 'FAL_KEY is not configured in .env. Please add your Fal API key.' 
      });
    }

    // 1. Upload reference portrait to Cloudinary (yanga-uploads)
    let referenceUpload = null;
    const base64Image = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;

    try {
      referenceUpload = await uploadReferenceImage(req.file.buffer, req.file.mimetype, { userId });
      console.log('Reference saved to Cloudinary:', referenceUpload.publicId);
    } catch (cErr) {
      console.warn('Notice: Cloudinary reference upload fallback to dataURI:', cErr.message);
    }

    // 2. Configure Fal and execute FLUX + PuLID
    fal.config({ credentials: falKey });

    const referenceUrl = referenceUpload?.secureUrl || dataURI;
    const result = await fal.subscribe('fal-ai/flux-pulid', {
      input: {
        prompt: prompt,
        reference_image_url: referenceUrl,
        image_size: 'portrait_4_3',
        num_inference_steps: 20,
        guidance_scale: 7.5
      }
    });

    const rawImageUrl = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
    if (!rawImageUrl) {
      throw new Error('No image URL returned from FAL model.');
    }

    // 3. Save generation permanently to Cloudinary (yanga-generations)
    let persistentGeneration = null;
    try {
      persistentGeneration = await uploadGeneratedImage(rawImageUrl, {
        userId,
        prompt,
        referenceUrl: referenceUpload?.secureUrl
      });
      console.log('Generation saved to Cloudinary:', persistentGeneration.publicId);
    } catch (saveErr) {
      console.error('Notice: Could not save generation to Cloudinary:', saveErr.message);
    }

    res.json({ 
      success: true, 
      imageUrl: persistentGeneration?.secureUrl || rawImageUrl,
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
