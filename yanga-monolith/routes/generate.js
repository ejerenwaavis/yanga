import express from 'express';
import multer from 'multer';
import { fal } from '@fal-ai/client';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body;
    
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

    fal.config({ credentials: falKey });

    // Convert memory buffer to Data URI for the API
    const base64Image = req.file.buffer.toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${base64Image}`;

    // Execute FLUX + PuLID via the fal JS client
    const result = await fal.subscribe('fal-ai/flux-pulid', {
      input: {
        prompt: prompt,
        reference_image_url: dataURI,
        image_size: 'portrait_4_3',
        num_inference_steps: 20,
        guidance_scale: 7.5
      }
    });

    const imageUrl = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL returned from FAL model.');
    }

    res.json({ success: true, imageUrl: imageUrl });
  } catch (error) {
    console.error('Generation Error:', error);
    const errorMessage = error?.body?.detail || error?.message || 'An unexpected error occurred during generation.';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
