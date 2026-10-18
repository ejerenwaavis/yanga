import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload reference selfie portrait to Cloudinary
 * Target folder: yanga-uploads or yanga-uploads/<userId>
 */
export async function uploadReferenceImage(buffer, mimetype, { userId } = {}) {
  const base64Image = buffer.toString('base64');
  const dataURI = `data:${mimetype};base64,${base64Image}`;
  
  const userFolder = userId ? `yanga-uploads/${userId}` : 'yanga-uploads';
  const tags = ['yanga-upload'];
  if (userId) tags.push(`user:${userId}`);

  const result = await cloudinary.uploader.upload(dataURI, {
    folder: userFolder,
    resource_type: 'image',
    tags,
    context: userId ? `userId=${userId}` : undefined
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    width: result.width,
    height: result.height
  };
}

/**
 * Upload AI photoshoot generated image to Cloudinary
 * Target folder: yanga-generations or yanga-generations/<userId>
 */
export async function uploadGeneratedImage(imageUrl, { userId, prompt, referenceUrl } = {}) {
  const userFolder = userId ? `yanga-generations/${userId}` : 'yanga-generations';
  const tags = ['yanga-generation'];
  if (userId) tags.push(`user:${userId}`);

  const result = await cloudinary.uploader.upload(imageUrl, {
    folder: userFolder,
    resource_type: 'image',
    tags,
    context: {
      userId: userId || '',
      prompt: (prompt || '').substring(0, 500),
      referenceUrl: referenceUrl || ''
    }
  });

  return {
    publicId: result.public_id,
    secureUrl: result.secure_url,
    width: result.width,
    height: result.height,
    createdAt: result.created_at
  };
}

/**
 * Retrieve generations for a specific user from Cloudinary
 */
export async function getUserGenerations(userId) {
  if (!userId) return [];

  try {
    const userFolder = `yanga-generations/${userId}`;
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: userFolder,
      max_results: 50,
      context: true,
      tags: true
    });

    return (result.resources || []).map((r) => ({
      publicId: r.public_id,
      imageUrl: r.secure_url,
      createdAt: r.created_at,
      width: r.width,
      height: r.height,
      prompt: r.context?.custom?.prompt || ''
    }));
  } catch (error) {
    console.error('Error fetching user generations from Cloudinary:', error);
    return [];
  }
}

export default cloudinary;
