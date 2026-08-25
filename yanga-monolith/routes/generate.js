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

    res.json({ success: true, imageUrl: result.images[0].url });
  } catch (error) {
    console.error('Generation Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
