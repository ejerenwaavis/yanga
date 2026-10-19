/**
 * Yanga Studio Scene Presets & Prompt Composition Constants
 * Pipeline v2: Full Starter Instructions & Composable Keep Locks
 */

export const SCENE_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'celebration', label: 'Birthday & Luxe' },
  { id: 'beach', label: 'Beach & Resort' },
  { id: 'owambe', label: 'Owambe & Cultural' },
  { id: 'lifestyle', label: 'Travel & Studio' }
];

export function getSceneSlug(sceneIdOrInstruction) {
  if (!sceneIdOrInstruction) return 'photo';
  const match = SCENES.find(s => s.id === sceneIdOrInstruction || s.starter === sceneIdOrInstruction);
  if (match) {
    return match.id.replace(/_/g, '-');
  }
  return sceneIdOrInstruction
    .toLowerCase()
    .replace(/^place me (in|on|at|along)\s+/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '') || 'photo';
}

export const SCENES = [
  // ─── Celebration & Birthday Luxe ──────────────────────────────────────────
  {
    id: 'penthouse_birthday',
    category: 'celebration',
    title: 'Penthouse Birthday Editorial',
    subtitle: 'Midnight luxury penthouse suite with city skyline view',
    starter: 'Place me in a luxury glass penthouse suite overlooking a glittering city night skyline with ambient chandelier lighting and celebratory golden atmosphere.',
    scenePrompt: 'Place me in a luxury glass penthouse suite overlooking a glittering city night skyline with ambient chandelier lighting and celebratory golden atmosphere.'
  },
  {
    id: 'rooftop_toast',
    category: 'celebration',
    title: 'Golden Hour Rooftop Toast',
    subtitle: 'Sun-drenched luxury terrace with warm sunset flare',
    starter: 'Place me on an exclusive private rooftop garden terrace at golden hour with soft warm backlight and a blurred urban panoramic skyline.',
    scenePrompt: 'Place me on an exclusive private rooftop garden terrace at golden hour with soft warm backlight and a blurred urban panoramic skyline.'
  },
  {
    id: 'vogue_birthday',
    category: 'celebration',
    title: 'Vogue Birthday Portrait',
    subtitle: 'High-concept fashion studio with subtle golden accents',
    starter: 'Place me in a high-end editorial fashion studio with subtle sculpted metallic gold balloon arrangements and minimalist floral set design.',
    scenePrompt: 'Place me in a high-end editorial fashion studio with subtle sculpted metallic gold balloon arrangements and minimalist floral set design.'
  },

  // ─── Beach & Resort ───────────────────────────────────────────────────────
  {
    id: 'coastline_sunset',
    category: 'beach',
    title: 'Golden Coastline Sunset',
    subtitle: 'Warm coastal breezes and cinematic sunset colors',
    starter: 'Place me along a private tropical coastline at sunset with gentle ocean breeze, pastel skies, and soft turquoise water reflections.',
    scenePrompt: 'Place me along a private tropical coastline at sunset with gentle ocean breeze, pastel skies, and soft turquoise water reflections.'
  },
  {
    id: 'yacht_deck',
    category: 'beach',
    title: 'Private Yacht Deck',
    subtitle: 'Mediterranean open sea luxury with crisp sunlit horizon',
    starter: 'Place me on the polished teak deck of a luxury superyacht cruising open deep blue ocean waters under bright natural daylight.',
    scenePrompt: 'Place me on the polished teak deck of a luxury superyacht cruising open deep blue ocean waters under bright natural daylight.'
  },
  {
    id: 'cabana_lounge',
    category: 'beach',
    title: 'Resort Cabana Lounge',
    subtitle: 'Shaded tropical cabana with palm leaf shadows and teak wood',
    starter: 'Place me in an exclusive shaded oceanfront cabana at a five-star private island resort with teak wood furnishings and tropical palm shadows.',
    scenePrompt: 'Place me in an exclusive shaded oceanfront cabana at a five-star private island resort with teak wood furnishings and tropical palm shadows.'
  },

  // ─── Owambe & Cultural ───────────────────────────────────────────────────
  {
    id: 'royal_owambe',
    category: 'owambe',
    title: 'Royal Owambe Reception',
    subtitle: 'Aso-Ebi luxury banquet with crystal chandelier bokeh',
    starter: 'Place me at an opulent Lagos wedding reception ballroom with dazzling crystal chandelier bokeh and warm festive banquet ambient lighting.',
    scenePrompt: 'Place me at an opulent Lagos wedding reception ballroom with dazzling crystal chandelier bokeh and warm festive banquet ambient lighting.'
  },
  {
    id: 'traditional_heritage',
    category: 'owambe',
    title: 'Traditional Heritage Portrait',
    subtitle: 'Regal heritage portrait studio with warm dramatic lighting',
    starter: 'Place me in a timeless royal heritage portrait studio with warm Rembrandt key lighting and rich textured shadowed backdrop.',
    scenePrompt: 'Place me in a timeless royal heritage portrait studio with warm Rembrandt key lighting and rich textured shadowed backdrop.'
  },
  {
    id: 'contemporary_trad',
    category: 'owambe',
    title: 'Contemporary Trad Chic',
    subtitle: 'Victoria Island courtyard with tropical greenery',
    starter: 'Place me in a modern architectural courtyard in Victoria Island Lagos surrounded by lush tropical greenery and minimalist stone walls.',
    scenePrompt: 'Place me in a modern architectural courtyard in Victoria Island Lagos surrounded by lush tropical greenery and minimalist stone walls.'
  },

  // ─── Travel & Studio ─────────────────────────────────────────────────────
  {
    id: 'mayfair_street',
    category: 'lifestyle',
    title: 'London Mayfair Street',
    subtitle: 'European luxury boutique street scene',
    starter: 'Place me on a cobbled London street in Mayfair at golden hour, with warm lit shop windows.',
    scenePrompt: 'Place me on a cobbled London street in Mayfair at golden hour, with warm lit shop windows.'
  },
  {
    id: 'corner_office',
    category: 'lifestyle',
    title: 'Executive Corner Office',
    subtitle: 'High-rise executive office with panoramic glass windows',
    starter: 'Place me in a sleek modern high-rise executive corner office with floor-to-ceiling panoramic glass windows overlooking a city skyline.',
    scenePrompt: 'Place me in a sleek modern high-rise executive corner office with floor-to-ceiling panoramic glass windows overlooking a city skyline.'
  },
  {
    id: 'charcoal_studio',
    category: 'lifestyle',
    title: 'Classic Charcoal Studio',
    subtitle: 'Timeless studio portrait with textured charcoal canvas',
    starter: 'Place me in an elite portrait studio against a hand-painted textured charcoal canvas backdrop with soft dramatic studio key lighting.',
    scenePrompt: 'Place me in an elite portrait studio against a hand-painted textured charcoal canvas backdrop with soft dramatic studio key lighting.'
  }
];

/**
 * Canonical Prompt Builder for Pipeline v2
 * Formula:
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

/**
 * Regex to detect when user instruction mentions clothing while "Keep my outfit" is active
 */
export const CLOTHING_REGEX = /\b(outfit|wearing?|dressed|jacket|suit|blazer|dress|tuxedo|shirt|jeans|pants|trousers|sweater|hoodie|coat|overcoat|skirt|robe|gown|attire|garment|aso[- ]?ebi|agbada|ankara|kaftan|senator|blouse|tie|bow[- ]?tie)\b/i;

// Deprecated in Pipeline v2 (retained for backward compatibility)
export const SUBJECT_TYPES = [
  { id: 'Nigerian woman', label: 'Woman' },
  { id: 'Nigerian man', label: 'Man' }
];

export const HAIRSTYLES = [
  { id: 'matching their natural hairstyle', label: 'Match Selfie' }
];

export const FRAMING_OPTIONS = [
  { id: 'Natural framing matching reference photo', label: 'Auto Framing' }
];

export const ASPECT_RATIOS = [
  { id: 'match_original', label: 'Original' }
];
