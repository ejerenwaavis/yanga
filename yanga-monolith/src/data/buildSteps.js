/**
 * Yanga Studio Step-by-Step Prompt Builder Configurations
 * Pipeline v2 Modular Composition
 */

// ─── 1. ORDERED BUILD STEPS ─────────────────────────────────────────────────
export const BUILD_STEPS = [
  {
    id: 'timeOfDay',
    title: 'Time of Day',
    helper: 'Lighting angle, sun position, and ambient natural luminance',
    selectMode: 'single',
    requiresUnlocked: null,
    options: [
      {
        id: 'golden_hour',
        label: 'Golden Hour',
        promptFragment: 'bathed in warm golden hour sunlight, low sun flare, radiant ambient warmth, and soft atmospheric backlighting'
      },
      {
        id: 'morning_light',
        label: 'Morning Light',
        promptFragment: 'illuminated by crisp morning sunlight, clean bright shadows, soft gentle daylight, and calm early morning atmosphere'
      },
      {
        id: 'midday_sun',
        label: 'Midday Sun',
        promptFragment: 'under bright direct midday sun with high-contrast sunlight, vibrant natural daylight illumination, and clean clear sky'
      },
      {
        id: 'blue_hour',
        label: 'Blue Hour',
        promptFragment: 'during tranquil blue hour twilight, deep indigo sky hues, subtle ambient dusk glow, and cool cinematic evening atmosphere'
      },
      {
        id: 'evening',
        label: 'Evening',
        promptFragment: 'in the warm glow of dusk and sunset with gentle twilight gradients, dusky shadows, and subtle warm ambient lighting'
      },
      {
        id: 'night',
        label: 'Night',
        promptFragment: 'set in the dark of night with dramatic contrast, illuminated by artificial lighting, deep shadows, and luminous ambient highlights'
      },
      {
        id: 'overcast',
        label: 'Overcast',
        promptFragment: 'under soft diffused overcast skies with smooth even natural lighting, gentle muted contrast, and calm neutral ambient illumination'
      }
    ]
  },
  {
    id: 'setting',
    title: 'Setting',
    helper: 'Physical environment, architectural space, or natural backdrop',
    selectMode: 'single',
    requiresUnlocked: null,
    options: [
      {
        id: 'city_street',
        label: 'City Street',
        promptFragment: 'on a vibrant urban city street with textured pavement, architectural building facades, and lively street-level metropolitan environment'
      },
      {
        id: 'rooftop',
        label: 'Rooftop',
        promptFragment: 'on an open-air panoramic rooftop terrace with distant urban skyline vistas, modern glass railings, and sweeping architectural views'
      },
      {
        id: 'cafe_restaurant',
        label: 'Cafe or Restaurant',
        promptFragment: 'inside an elegant boutique cafe and restaurant with chic dining tables, ambient pendant lights, and tasteful interior decor'
      },
      {
        id: 'living_room',
        label: 'Living Room',
        promptFragment: 'inside a stylish contemporary residential living room with comfortable designer furniture, curated wall art, and cozy domestic interior'
      },
      {
        id: 'bedroom',
        label: 'Bedroom',
        promptFragment: 'in a modern luxury bedroom setting with plush bedding, clean aesthetic interior styling, and soft ambient bedroom decor'
      },
      {
        id: 'backyard_garden',
        label: 'Backyard or Garden',
        promptFragment: 'in a lush private backyard garden surrounded by flowering shrubs, green lawn landscaping, and tranquil outdoor greenery'
      },
      {
        id: 'beach',
        label: 'Beach',
        promptFragment: 'along a scenic coastline beach with soft sand shores, gentle ocean waves, and open sea horizon landscape'
      },
      {
        id: 'poolside',
        label: 'Poolside',
        promptFragment: 'by a resort luxury swimming pool with glistening turquoise water reflections, stone pool deck, and outdoor sun loungers'
      },
      {
        id: 'studio_backdrop',
        label: 'Studio Backdrop',
        promptFragment: 'in a clean professional photo studio against a seamless textured minimalist photography canvas backdrop with controlled lighting'
      },
      {
        id: 'market',
        label: 'Market',
        promptFragment: 'amidst a bustling open-air artisan market with colorful stall canopies, vibrant trade atmosphere, and textured cultural market backdrop'
      },
      {
        id: 'hotel_lobby',
        label: 'Hotel Lobby',
        promptFragment: 'in an opulent luxury hotel lobby with polished marble floors, architectural pillars, and sophisticated hospitality lounge atmosphere'
      },
      {
        id: 'car_roadtrip',
        label: 'Car / Road Trip',
        promptFragment: 'on a scenic road trip with a premium automobile vehicle, open highway roadside setting, and adventurous travel backdrop'
      }
    ]
  },
  {
    id: 'occasion',
    title: 'Occasion',
    helper: 'Event theme, celebratory gathering, or social purpose',
    selectMode: 'single',
    requiresUnlocked: null,
    options: [
      {
        id: 'casual_day',
        label: 'Casual Day Out',
        promptFragment: 'for a relaxed effortless casual day out with laid-back weekend energy, candid everyday warmth, and unhurried natural atmosphere'
      },
      {
        id: 'birthday',
        label: 'Birthday',
        promptFragment: 'celebrating a milestone birthday celebration with celebratory festive flair, joyful birthday ambiance, and luxury anniversary cheer'
      },
      {
        id: 'owambe',
        label: 'Owambe / Traditional Celebration',
        promptFragment: 'at an extravagant celebratory Nigerian owambe party with rich cultural splendor, regal festive energy, and vibrant celebratory fanfare'
      },
      {
        id: 'wedding_guest',
        label: 'Wedding Guest',
        promptFragment: 'attending an elegant wedding ceremony celebration with sophisticated guest atmosphere, romantic banquet styling, and refined formal celebration aesthetics'
      },
      {
        id: 'pool_party',
        label: 'Pool Party',
        promptFragment: 'at a lively summer pool party event with vibrant daytime festivities, upbeat outdoor entertainment, and refreshing splash-side atmosphere'
      },
      {
        id: 'beach_day',
        label: 'Beach Day',
        promptFragment: 'enjoying a sunny coastal beach day with relaxed seaside leisure, oceanfront recreation, and carefree coastal vacation vibe'
      },
      {
        id: 'night_out',
        label: 'Night Out / Club',
        promptFragment: 'for an exciting evening night out and VIP lounge social scene with vibrant nightlife ambience and upscale party energy'
      },
      {
        id: 'dinner_date',
        label: 'Dinner Date',
        promptFragment: 'for an intimate romantic dinner date evening with candlelit ambiance, quiet upscale restaurant hospitality, and sophisticated evening warmth'
      },
      {
        id: 'graduation',
        label: 'Graduation',
        promptFragment: 'celebrating an academic graduation milestone with proud ceremonial achievement atmosphere, commencement festivities, and joyous scholarly honor'
      },
      {
        id: 'photoshoot_editorial',
        label: 'Photoshoot / Editorial',
        promptFragment: 'for a high-fashion editorial magazine photoshoot with striking art-directed composition, avant-garde production design, and polished commercial aesthetic'
      },
      {
        id: 'holiday_festive',
        label: 'Holiday / Festive',
        promptFragment: 'during joyous seasonal holiday festivities with sparkling winter holiday cheer, festive celebration decor, and warm holiday gathering atmosphere'
      },
      {
        id: 'brunch',
        label: 'Brunch',
        promptFragment: 'for a relaxed weekend brunch social gathering with sunny midday socializing, cafe patio ambiance, and cheerful leisure hospitality'
      }
    ]
  },
  {
    id: 'posture',
    title: 'Posture & Pose',
    helper: 'Subject stance and physical arrangement (requires Pose unlocked)',
    selectMode: 'single',
    requiresUnlocked: 'pose',
    options: [
      {
        id: 'standing_confident',
        label: 'Standing Confident',
        promptFragment: 'in a poised upright standing posture, positioned tall and confident with poised natural posture and balanced positioning'
      },
      {
        id: 'walking',
        label: 'Walking',
        promptFragment: 'captured mid-stride in a natural walking posture, stepping forward with graceful movement and authentic directional motion'
      },
      {
        id: 'sitting_relaxed',
        label: 'Sitting Relaxed',
        promptFragment: 'seated in a comfortable relaxed sitting posture with natural restful composure, leaned back with gentle seated posture'
      },
      {
        id: 'leaning',
        label: 'Leaning',
        promptFragment: 'casually leaning against a supportive railing or architectural element with relaxed casual angle and effortless posture'
      },
      {
        id: 'candid_laugh',
        label: 'Candid Laugh',
        promptFragment: 'posed in a spontaneous candid moment of laughter and genuine enjoyment, tilted slightly with authentic unposed posture'
      },
      {
        id: 'over_shoulder',
        label: 'Over-the-Shoulder',
        promptFragment: 'turned partially in a dynamic three-quarter over-the-shoulder posture, facing back toward the camera with elegant posture angle'
      },
      {
        id: 'hands_pockets',
        label: 'Hands in Pockets',
        promptFragment: 'standing relaxed with hands placed casually in pockets, projecting effortless casual coolness and comfortable natural balance'
      },
      {
        id: 'mid_motion',
        label: 'Mid-Motion',
        promptFragment: 'captured in dynamic mid-motion movement with fluid dynamic energy, natural momentum, and energetic candid physical flow'
      }
    ]
  },
  {
    id: 'mood',
    title: 'Mood & Aesthetic',
    helper: 'Emotional resonance, color tone, and cinematic visual styling',
    selectMode: 'single',
    requiresUnlocked: null,
    options: [
      {
        id: 'glam',
        label: 'Glam',
        promptFragment: 'with luxurious high-glamour aesthetic, radiant polished styling, sparkling upscale luster, and magnificent editorial sophistication'
      },
      {
        id: 'soft_dreamy',
        label: 'Soft and Dreamy',
        promptFragment: 'with ethereal soft and dreamy aesthetic, gentle pastel highlights, delicate feathered diffusion, and poetic romantic atmosphere'
      },
      {
        id: 'bold_editorial',
        label: 'Bold and Editorial',
        promptFragment: 'with bold high-contrast editorial photography aesthetic, clean razor-sharp art direction, and striking contemporary magazine visual impact'
      },
      {
        id: 'warm_cozy',
        label: 'Warm and Cozy',
        promptFragment: 'with warm cozy golden-toned atmosphere, comforting intimate glow, inviting ambient shadows, and gentle nostalgic warmth'
      },
      {
        id: 'cinematic',
        label: 'Cinematic',
        promptFragment: 'with dramatic cinematic widescreen atmosphere, rich color grading, deep atmospheric shadows, and cinematic storytelling depth'
      },
      {
        id: 'playful',
        label: 'Playful',
        promptFragment: 'with joyful playful and lively aesthetic, spirited cheerful ambiance, uplifting dynamic color, and vivacious celebratory mood'
      }
    ]
  },
  {
    id: 'extras',
    title: 'Extras & Details',
    helper: 'Decorative accents, environmental props, and celebratory elements',
    selectMode: 'multi',
    requiresUnlocked: null,
    options: [
      {
        id: 'confetti',
        label: 'Confetti',
        promptFragment: 'surrounded by metallic gold and colorful festive confetti fluttering lightly through the atmospheric air'
      },
      {
        id: 'string_lights',
        label: 'String Lights',
        promptFragment: 'accented with glowing overhead string fairy lights casting warm delicate light sparkles across the background'
      },
      {
        id: 'balloons',
        label: 'Balloons',
        promptFragment: 'adorned with elegant sculpted luxury metallic and pastel balloon arrangements framing the celebratory scene'
      },
      {
        id: 'city_bokeh',
        label: 'City Bokeh',
        promptFragment: 'featuring glistening out-of-focus city light bokeh spheres shimmering softly in the distant background depth'
      },
      {
        id: 'falling_leaves',
        label: 'Falling Leaves',
        promptFragment: 'accented by gentle falling autumn leaves swirling softly in the background outdoor atmosphere'
      },
      {
        id: 'sparklers',
        label: 'Sparklers',
        promptFragment: 'illuminated by luminous celebratory hand sparklers with radiant glittering gold sparks and festive smoke haze'
      },
      {
        id: 'drinks_in_hand',
        label: 'Drinks in Hand',
        promptFragment: 'accompanied by crystal glassware with celebratory champagne beverages resting naturally within the setting'
      },
      {
        id: 'background_guests',
        label: 'Background Guests',
        promptFragment: 'with softly blurred tasteful celebratory party guests mingling in the deep background out-of-focus plane'
      }
    ]
  },
  {
    id: 'wardrobe',
    title: 'Wardrobe & Attire',
    helper: 'Fashion styling, garments, and cultural dress (requires Outfit unlocked)',
    selectMode: 'single',
    requiresUnlocked: 'outfit',
    options: [
      {
        id: 'agbada_regal',
        label: 'Regal Agbada',
        tags: ['owambe', 'traditional_heritage', 'wedding_guest'],
        promptFragment: 'wearing an opulent richly embroidered ceremonial agbada robe with crisp architectural shoulders and tailored matching trousers'
      },
      {
        id: 'aso_ebi_lace',
        label: 'Aso-Ebi Luxury Lace',
        tags: ['owambe', 'wedding_guest', 'birthday'],
        promptFragment: 'dressed in a bespoke luxury lace owambe gown with ornate crystal beadwork detailing and regal traditional silhouette'
      },
      {
        id: 'senator_suit',
        label: 'Contemporary Senator Suit',
        tags: ['owambe', 'wedding_guest', 'dinner_date', 'casual_day'],
        promptFragment: 'wearing a sleek tailored modern African senator suit with sharp geometric collar detailing and clean minimalist lines'
      },
      {
        id: 'evening_tuxedo',
        label: 'Black Tie Tuxedo',
        tags: ['birthday', 'night_out', 'dinner_date', 'wedding_guest', 'photoshoot_editorial'],
        promptFragment: 'attired in a bespoke black-tie dinner tuxedo with satin peak lapels, tailored trousers, and polished evening styling'
      },
      {
        id: 'cocktail_dress',
        label: 'Glamorous Cocktail Dress',
        tags: ['birthday', 'night_out', 'dinner_date', 'wedding_guest', 'brunch'],
        promptFragment: 'wearing a stunning tailored designer cocktail dress with shimmering fabric texture, sculpted draping, and glamorous luxury finish'
      },
      {
        id: 'swimwear_coverup',
        label: 'Resort Swimwear Cover-Up',
        tags: ['pool_party', 'beach_day'],
        promptFragment: 'attired in breezy resort swimwear with a flowing sheer silk kimono cover-up and stylish luxury resort styling'
      },
      {
        id: 'casual_chic',
        label: 'Casual Chic Streetwear',
        tags: ['casual_day', 'brunch', 'car_roadtrip'],
        promptFragment: 'wearing a stylish contemporary casual ensemble with a fitted premium jacket, designer tee, and tailored relaxed trousers'
      },
      {
        id: 'linen_resort',
        label: 'Linen Resort Wear',
        tags: ['beach_day', 'pool_party', 'brunch', 'casual_day'],
        promptFragment: 'attired in relaxed breathable luxury white linen shirt and matching relaxed trousers with effortless tropical resort sophistication'
      },
      {
        id: 'executive_blazer',
        label: 'Executive Blazer & Tailoring',
        tags: ['graduation', 'dinner_date', 'photoshoot_editorial', 'brunch'],
        promptFragment: 'wearing a sharply tailored structured designer blazer paired with elegant trousers and sophisticated modern professional styling'
      },
      {
        id: 'graduation_gown',
        label: 'Academic Graduation Attire',
        tags: ['graduation'],
        promptFragment: 'wearing a distinguished academic graduation commencement gown with ceremonial sash drape and polished commencement celebration styling'
      },
      {
        id: 'high_fashion_editorial',
        label: 'High-Fashion Avant-Garde',
        tags: ['photoshoot_editorial', 'birthday', 'night_out'],
        promptFragment: 'attired in an avant-garde runway haute couture creation featuring sculptural silhouettes, dramatic fabric architecture, and editorial elegance'
      },
      {
        id: 'festive_velvet',
        label: 'Festive Velvet Attire',
        tags: ['holiday_festive', 'dinner_date', 'birthday'],
        promptFragment: 'wearing rich jewel-toned plush velvet festive attire with tailored luxury contours and opulent seasonal celebration warmth'
      }
    ]
  }
];

// ─── 2. BUILD CONFLICT RULES & DETECTOR ─────────────────────────────────────
export const BUILD_CONFLICTS = [
  {
    when: { timeOfDay: 'midday_sun', occasion: 'night_out' },
    message: 'Night out / club atmosphere clashes with midday sun. Consider evening, night, or blue hour.'
  },
  {
    when: { timeOfDay: 'night', occasion: 'beach_day' },
    message: 'Beach day is typically bright and sunny. Consider morning light or golden hour.'
  },
  {
    when: { timeOfDay: 'night', occasion: 'brunch' },
    message: 'Brunch is a daytime occasion. Consider morning light or midday sun.'
  },
  {
    when: { timeOfDay: 'midday_sun', extras: 'sparklers' },
    message: 'Sparklers are best appreciated in dark or evening light rather than direct midday sun.'
  },
  {
    when: { setting: 'beach', extras: 'city_bokeh' },
    message: 'City bokeh lights clash with an open natural beach setting.'
  },
  {
    when: { setting: 'bedroom', occasion: 'pool_party' },
    message: 'Pool party occasion clashes with an indoor bedroom setting.'
  },
  {
    when: { setting: 'living_room', occasion: 'beach_day' },
    message: 'Beach day occasion clashes with an indoor living room setting.'
  },
  {
    when: { setting: 'beach', wardrobe: 'evening_tuxedo' },
    message: 'A formal evening tuxedo clashes with an open beach shoreline.'
  },
  {
    when: { setting: 'beach', wardrobe: 'graduation_gown' },
    message: 'Academic graduation gown clashes with a beach setting.'
  },
  {
    when: { setting: 'poolside', wardrobe: 'evening_tuxedo' },
    message: 'A formal tuxedo clashes with a poolside swimming environment.'
  },
  {
    when: { setting: 'studio_backdrop', extras: 'falling_leaves' },
    message: 'Falling outdoor leaves clash with a seamless indoor studio canvas backdrop.'
  },
  {
    when: { occasion: 'pool_party', wardrobe: 'agbada_regal' },
    message: 'Ceremonial Agbada attire clashes with a swimming pool party.'
  },
  {
    when: { occasion: 'owambe', wardrobe: 'swimwear_coverup' },
    message: 'Swimwear cover-up clashes with a formal Owambe celebration.'
  }
];

/**
 * Evaluates selections against BUILD_CONFLICTS.
 * Returns array of matching conflict objects { message, when }.
 */
export function detectBuildConflicts(selections = {}) {
  if (!selections || typeof selections !== 'object') return [];
  const results = [];

  for (const conflict of BUILD_CONFLICTS) {
    const { when, message } = conflict;
    const isMatch = Object.entries(when).every(([stepId, expectedVal]) => {
      const selected = selections[stepId];
      if (selected === undefined || selected === null) return false;
      if (Array.isArray(selected)) {
        return selected.includes(expectedVal);
      }
      return selected === expectedVal;
    });

    if (isMatch) {
      results.push({ message, when });
    }
  }

  return results;
}

// ─── 3. COMPOSE BUILD INSTRUCTION ──────────────────────────────────────────
/**
 * Composes canonical build instruction from modular step selections.
 * Skips steps whose requiresUnlocked lock is still active (true) in keepLocks.
 * Appends freeText.trim() LAST as the user's custom instructions.
 * Returns empty string if nothing selected and freeText is empty.
 */
export function composeBuildInstruction(selections = {}, freeText = '', keepLocks = {}) {
  const fragments = [];

  for (const step of BUILD_STEPS) {
    // Skip any step whose requiresUnlocked lock is still true in keepLocks
    if (step.requiresUnlocked && keepLocks && keepLocks[step.requiresUnlocked]) {
      continue;
    }

    const val = selections ? selections[step.id] : undefined;
    if (val === undefined || val === null) {
      continue;
    }

    if (step.selectMode === 'multi') {
      const ids = Array.isArray(val) ? val : [val];
      for (const id of ids) {
        const opt = step.options.find((o) => o.id === id);
        if (opt && opt.promptFragment) {
          fragments.push(opt.promptFragment.trim());
        }
      }
    } else {
      const opt = step.options.find((o) => o.id === val);
      if (opt && opt.promptFragment) {
        fragments.push(opt.promptFragment.trim());
      }
    }
  }

  const cleanFreeText = (freeText || '').trim();

  // Return an empty string if nothing is selected and freeText is empty
  if (fragments.length === 0 && !cleanFreeText) {
    return '';
  }

  if (cleanFreeText) {
    fragments.push(cleanFreeText);
  }

  return fragments.join(', ');
}

// ─── 4. PRESET LOOKUP TABLE & PREFILL MAPPER ────────────────────────────────
export const SCENE_BUILD_PRESETS = {
  penthouse_birthday: {
    timeOfDay: 'night',
    setting: 'rooftop',
    occasion: 'birthday',
    mood: 'glam',
    extras: ['city_bokeh', 'drinks_in_hand']
  },
  rooftop_toast: {
    timeOfDay: 'golden_hour',
    setting: 'rooftop',
    occasion: 'birthday',
    mood: 'warm_cozy',
    extras: ['city_bokeh', 'drinks_in_hand']
  },
  vogue_birthday: {
    timeOfDay: 'morning_light',
    setting: 'studio_backdrop',
    occasion: 'birthday',
    mood: 'bold_editorial',
    extras: ['balloons']
  },
  coastline_sunset: {
    timeOfDay: 'evening',
    setting: 'beach',
    occasion: 'beach_day',
    mood: 'soft_dreamy',
    extras: []
  },
  yacht_deck: {
    timeOfDay: 'midday_sun',
    setting: 'beach',
    occasion: 'casual_day',
    mood: 'glam',
    extras: ['drinks_in_hand']
  },
  cabana_lounge: {
    timeOfDay: 'golden_hour',
    setting: 'beach',
    occasion: 'casual_day',
    mood: 'warm_cozy',
    extras: []
  },
  royal_owambe: {
    timeOfDay: 'evening',
    setting: 'hotel_lobby',
    occasion: 'owambe',
    mood: 'glam',
    extras: ['string_lights', 'background_guests'],
    wardrobe: 'aso_ebi_lace'
  },
  traditional_heritage: {
    timeOfDay: 'evening',
    setting: 'studio_backdrop',
    occasion: 'owambe',
    mood: 'cinematic',
    wardrobe: 'agbada_regal'
  },
  contemporary_trad: {
    timeOfDay: 'golden_hour',
    setting: 'backyard_garden',
    occasion: 'owambe',
    mood: 'bold_editorial',
    wardrobe: 'senator_suit'
  },
  mayfair_street: {
    timeOfDay: 'golden_hour',
    setting: 'city_street',
    occasion: 'casual_day',
    mood: 'warm_cozy',
    extras: ['city_bokeh'],
    wardrobe: 'casual_chic'
  },
  corner_office: {
    timeOfDay: 'morning_light',
    setting: 'hotel_lobby',
    occasion: 'photoshoot_editorial',
    mood: 'bold_editorial',
    extras: ['city_bokeh'],
    wardrobe: 'executive_blazer'
  },
  charcoal_studio: {
    timeOfDay: 'overcast',
    setting: 'studio_backdrop',
    occasion: 'photoshoot_editorial',
    mood: 'cinematic',
    extras: []
  }
};

/**
 * Maps a scene's buildPreset or scene.id to a selections object for Build Mode.
 */
export function presetToBuildSelections(scene) {
  if (!scene) return {};
  if (scene.buildPreset && typeof scene.buildPreset === 'object') {
    return { ...scene.buildPreset };
  }
  const id = typeof scene === 'string' ? scene : scene.id;
  const match = SCENE_BUILD_PRESETS[id];
  return match ? { ...match } : {};
}
