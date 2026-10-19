/**
 * Yanga Studio Scene Presets & Subject Calibration Constants
 * Pipeline v2 Scene Noun Phrases (Designed for background substitution)
 */

export const SCENE_CATEGORIES = [
  { id: 'celebration', label: 'Birthday & Luxe' },
  { id: 'beach', label: 'Beach & Resort' },
  { id: 'owambe', label: 'Owambe & Cultural' },
  { id: 'lifestyle', label: 'Travel & Studio' }
];

export const SCENES = [
  // ─── Celebration & Birthday Luxe ──────────────────────────────────────────
  {
    id: 'penthouse_birthday',
    category: 'celebration',
    title: 'Penthouse Birthday Editorial',
    subtitle: 'Midnight luxury penthouse suite with city skyline view',
    scenePrompt: 'a luxury glass penthouse suite overlooking a glittering city night skyline with ambient chandelier lighting and celebratory golden atmosphere'
  },
  {
    id: 'rooftop_toast',
    category: 'celebration',
    title: 'Golden Hour Rooftop Toast',
    subtitle: 'Sun-drenched luxury terrace with warm sunset flare',
    scenePrompt: 'an exclusive private rooftop garden terrace at golden hour with soft warm backlight and a blurred urban panoramic skyline'
  },
  {
    id: 'vogue_birthday',
    category: 'celebration',
    title: 'Vogue Birthday Portrait',
    subtitle: 'High-concept fashion studio with subtle golden accents',
    scenePrompt: 'a high-end editorial fashion studio with subtle sculpted metallic gold balloon arrangements and minimalist floral set design'
  },

  // ─── Beach & Resort ───────────────────────────────────────────────────────
  {
    id: 'coastline_sunset',
    category: 'beach',
    title: 'Golden Coastline Sunset',
    subtitle: 'Warm coastal breezes and cinematic sunset colors',
    scenePrompt: 'a private tropical coastline at sunset with gentle ocean breeze, pastel skies, and soft turquoise water reflections'
  },
  {
    id: 'yacht_deck',
    category: 'beach',
    title: 'Private Yacht Deck',
    subtitle: 'Mediterranean open sea luxury with crisp sunlit horizon',
    scenePrompt: 'the polished teak deck of a luxury superyacht cruising open deep blue ocean waters under bright natural daylight'
  },
  {
    id: 'cabana_lounge',
    category: 'beach',
    title: 'Resort Cabana Lounge',
    subtitle: 'Shaded tropical cabana with palm leaf shadows and teak wood',
    scenePrompt: 'an exclusive shaded oceanfront cabana at a five-star private island resort with teak wood furnishings and tropical palm shadows'
  },

  // ─── Owambe & Cultural ───────────────────────────────────────────────────
  {
    id: 'royal_owambe',
    category: 'owambe',
    title: 'Royal Owambe Reception',
    subtitle: 'Aso-Ebi luxury banquet with crystal chandelier bokeh',
    scenePrompt: 'an opulent Lagos wedding reception ballroom with dazzling crystal chandelier bokeh and warm festive banquet ambient lighting'
  },
  {
    id: 'traditional_heritage',
    category: 'owambe',
    title: 'Traditional Heritage Portrait',
    subtitle: 'Regal heritage portrait studio with warm dramatic lighting',
    scenePrompt: 'a timeless royal heritage portrait studio with warm Rembrandt key lighting and rich textured shadowed backdrop'
  },
  {
    id: 'contemporary_trad',
    category: 'owambe',
    title: 'Contemporary Trad Chic',
    subtitle: 'Victoria Island courtyard with tropical greenery',
    scenePrompt: 'a modern architectural courtyard in Victoria Island Lagos surrounded by lush tropical greenery and minimalist stone walls'
  },

  // ─── Travel & Studio ─────────────────────────────────────────────────────
  {
    id: 'mayfair_street',
    category: 'lifestyle',
    title: 'London Mayfair Street',
    subtitle: 'European luxury boutique street scene',
    scenePrompt: 'a cobblestone street in London Mayfair outside luxury boutique facades with soft natural daylight and historic architecture'
  },
  {
    id: 'corner_office',
    category: 'lifestyle',
    title: 'Executive Corner Office',
    subtitle: 'High-rise executive office with panoramic glass windows',
    scenePrompt: 'a sleek modern high-rise executive corner office with floor-to-ceiling panoramic glass windows overlooking a city skyline'
  },
  {
    id: 'charcoal_studio',
    category: 'lifestyle',
    title: 'Classic Charcoal Studio',
    subtitle: 'Timeless studio portrait with textured charcoal canvas',
    scenePrompt: 'an elite portrait studio with a hand-painted textured charcoal canvas backdrop and soft dramatic studio key lighting'
  }
];

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
