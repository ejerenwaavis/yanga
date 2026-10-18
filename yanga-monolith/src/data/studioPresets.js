/**
 * Yanga Studio Scene Presets & Subject Calibration Constants
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
    subtitle: 'Midnight high-fashion birthday celebration with city skyline bokeh',
    scenePrompt: 'in a luxury glass penthouse suite overlooking a glittering city night skyline, holding an elegant crystal glass of vintage champagne, glamorous bespoke celebratory evening couture, warm ambient interior chandelier glow with shallow depth of field, dramatic editorial rim lighting, festive golden atmosphere'
  },
  {
    id: 'rooftop_toast',
    category: 'celebration',
    title: 'Golden Hour Rooftop Toast',
    subtitle: 'Sun-drenched luxury terrace with warm amber flare',
    scenePrompt: 'on an exclusive private rooftop garden terrace at golden hour, wearing a high-end tailored satin celebratory outfit, soft natural amber lens flare, warm backlight wrapping around silhouette, blurred urban panoramic skyline, relaxed confident celebratory expression'
  },
  {
    id: 'vogue_birthday',
    category: 'celebration',
    title: 'Vogue Birthday Portrait',
    subtitle: 'High-concept high-fashion studio editorial with subtle birthday accents',
    scenePrompt: 'in a high-end Vogue editorial fashion studio, surrounded by subtle sculpted metallic gold balloon arrangements and minimalist floral set design, dramatic sculpted beauty dish lighting, wearing a couture designer statement garment, sharp editorial eye contact, magazine cover grade framing'
  },

  // ─── Beach & Resort ───────────────────────────────────────────────────────
  {
    id: 'coastline_sunset',
    category: 'beach',
    title: 'Golden Coastline Sunset',
    subtitle: 'Warm coastal breezes and cinematic sunset rim light',
    scenePrompt: 'standing along a private tropical coastline at sunset, wearing refined lightweight linen resort wear, gentle sea breeze catching clothing, warm golden rim lighting along shoulders and hair, soft turquoise ocean surf and pastel sunset sky in background with cinematic depth of field'
  },
  {
    id: 'yacht_deck',
    category: 'beach',
    title: 'Private Yacht Deck',
    subtitle: 'Mediterranean open sea luxury with crisp sunlit reflections',
    scenePrompt: 'on the polished teak deck of a luxury superyacht cruising open deep blue waters, wearing stylish designer sunglasses resting naturally, crisp tailored white resort attire, natural bright sunlight with soft fill bounce from water reflections, serene affluent coastal horizon'
  },
  {
    id: 'cabana_lounge',
    category: 'beach',
    title: 'Resort Cabana Lounge',
    subtitle: 'Shaded tropical cabana with palm leaf shadows and teak wood',
    scenePrompt: 'relaxing in an exclusive shaded oceanfront cabana at a five-star private island resort, dappled natural tropical palm shadows, wearing silk patterned resort apparel, handcrafted rattan and teak furnishings, warm tropical breeze, relaxed luxurious vacation mood'
  },

  // ─── Owambe & Cultural ───────────────────────────────────────────────────
  {
    id: 'royal_owambe',
    category: 'owambe',
    title: 'Royal Owambe Reception',
    subtitle: 'Aso-Ebi luxury banquet with crystal chandelier bokeh',
    scenePrompt: 'at an opulent Lagos wedding reception ballroom, wearing exquisite heavily embroidered Nigerian Aso-Ebi luxury lace attire with metallic thread accents, dazzling crystal chandelier bokeh background, warm festive ambient banquet lighting, joyful regal presence'
  },
  {
    id: 'traditional_heritage',
    category: 'owambe',
    title: 'Traditional Heritage Portrait',
    subtitle: 'Coral bead royalty with warm dramatic studio lighting',
    scenePrompt: 'in a timeless high-fashion heritage portrait studio, adorned with layered authentic heavy royal coral bead necklaces and bracelets, wearing rich textured hand-woven Aso-Oke fabric, warm Rembrandt key lighting with rich shadowed background, deeply dignified and stately posture'
  },
  {
    id: 'contemporary_trad',
    category: 'owambe',
    title: 'Contemporary Trad Chic',
    subtitle: 'Victoria Island courtyard with minimalist modern native wear',
    scenePrompt: 'in a modern architectural courtyard in Victoria Island Lagos, surrounded by tropical foliage and minimalist stone walls, wearing a crisp modern monochromatic tailored Nigerian native outfit with sharp contemporary cuts, natural soft diffused daylight, chic understated African luxury'
  },

  // ─── Travel & Studio ─────────────────────────────────────────────────────
  {
    id: 'mayfair_street',
    category: 'lifestyle',
    title: 'London Mayfair Street',
    subtitle: 'Moody European luxury boutique street scene',
    scenePrompt: 'walking along a cobblestone street in London Mayfair outside luxury boutique facades, wearing a tailored cashmere overcoat and designer knitwear, soft overcast London daylight, cinematic shallow depth of field with classic black cabs and historic brickwork blurred in background'
  },
  {
    id: 'corner_office',
    category: 'lifestyle',
    title: 'Executive Corner Office',
    subtitle: 'Power portrait in high-rise boardroom with floor-to-ceiling glass',
    scenePrompt: 'in a sleek modern high-rise executive corner office, sitting by floor-to-ceiling panoramic glass windows overlooking city skyline, wearing an impeccably tailored bespoke business suit, clean modern architectural interior, crisp natural window light, commanding executive confidence'
  },
  {
    id: 'charcoal_studio',
    category: 'lifestyle',
    title: 'Classic Charcoal Studio',
    subtitle: 'Timeless monochrome editorial with deep textured shadows',
    scenePrompt: 'in an elite portrait studio against a hand-painted textured charcoal canvas backdrop, dramatic single key light and subtle kicker light, wearing minimal tailored black luxury clothing, rich tonal contrast, timeless classic fine-art photography aesthetic'
  }
];

export const SUBJECT_TYPES = [
  { id: 'Nigerian woman', label: 'Woman' },
  { id: 'Nigerian man', label: 'Man' }
];

export const HAIRSTYLES = [
  { id: 'matching their natural hairstyle', label: 'Match Selfie' },
  { id: 'with neat intricate braided hair', label: 'Braids' },
  { id: 'wearing an elegant matching Nigerian Gele headwrap', label: 'Gele / Headwrap' },
  { id: 'wearing a traditional Nigerian Fila cap', label: 'Fila Cap' },
  { id: 'with a sharp clean low skin-fade haircut', label: 'Clean Fade' },
  { id: 'with a clean-shaven bald head', label: 'Clean Bald' }
];

export const FRAMING_OPTIONS = [
  { id: 'Waist-up medium editorial portrait', label: 'Waist-Up Shoot' },
  { id: 'Close-up head and shoulders portrait', label: 'Close-Up Portrait' },
  { id: 'Three-quarter length standing portrait', label: '3/4 Standing Pose' }
];

export const ASPECT_RATIOS = [
  { id: 'ig_feed_4_5', label: 'IG Feed (4:5)' },
  { id: 'story_9_16', label: 'Story / Reel (9:16)' },
  { id: 'square_hd', label: 'Square HD (1:1)' }
];
