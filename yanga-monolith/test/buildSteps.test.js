import assert from 'node:assert';
import { 
  BUILD_STEPS, 
  BUILD_CONFLICTS, 
  detectBuildConflicts, 
  composeBuildInstruction, 
  presetToBuildSelections 
} from '../src/data/buildSteps.js';

console.log('🧪 Running buildSteps unit tests...');

// 1. Empty selections and empty freeText returns empty string
{
  const result = composeBuildInstruction({}, '', {});
  assert.strictEqual(result, '', 'Empty selections & freeText should return empty string');
  console.log('✓ Test 1 Passed: Empty selections returns empty string');
}

// 2. Locked pose skips posture fragment
{
  const selections = {
    timeOfDay: 'golden_hour',
    setting: 'rooftop',
    posture: 'standing_confident'
  };
  const keepLocks = { pose: true, outfit: true };
  const result = composeBuildInstruction(selections, '', keepLocks);

  assert.ok(result.includes('golden hour'), 'Result must include timeOfDay');
  assert.ok(result.includes('rooftop terrace'), 'Result must include setting');
  assert.ok(!result.includes('standing posture'), 'Locked pose MUST skip posture fragment');
  console.log('✓ Test 2 Passed: Locked pose successfully skips posture');
}

// 3. Unlocked pose includes posture fragment
{
  const selections = {
    timeOfDay: 'golden_hour',
    setting: 'rooftop',
    posture: 'standing_confident'
  };
  const keepLocks = { pose: false, outfit: true };
  const result = composeBuildInstruction(selections, '', keepLocks);

  assert.ok(result.includes('standing posture'), 'Unlocked pose MUST include posture fragment');
  console.log('✓ Test 3 Passed: Unlocked pose includes posture');
}

// 4. Locked outfit skips wardrobe fragment, unlocked outfit includes it
{
  const selections = {
    occasion: 'owambe',
    wardrobe: 'agbada_regal'
  };
  const lockedResult = composeBuildInstruction(selections, '', { outfit: true });
  assert.ok(!lockedResult.includes('agbada'), 'Locked outfit MUST skip wardrobe');

  const unlockedResult = composeBuildInstruction(selections, '', { outfit: false });
  assert.ok(unlockedResult.includes('agbada'), 'Unlocked outfit MUST include wardrobe');
  console.log('✓ Test 4 Passed: Outfit lock correctly gates wardrobe selection');
}

// 5. freeText is ALWAYS appended LAST
{
  const selections = {
    timeOfDay: 'golden_hour',
    setting: 'rooftop',
    mood: 'glam',
    extras: ['city_bokeh', 'drinks_in_hand']
  };
  const userFreeText = 'Please make sure my vintage watch is visible.';
  const result = composeBuildInstruction(selections, userFreeText, { pose: true, outfit: true });

  assert.ok(result.endsWith(userFreeText), 'freeText MUST be appended last');
  console.log('✓ Test 5 Passed: freeText is always appended last');
}

// 6. Only freeText provided returns trimmed freeText
{
  const result = composeBuildInstruction({}, '  Only custom text here   ', {});
  assert.strictEqual(result, 'Only custom text here', 'Only freeText should return trimmed text');
  console.log('✓ Test 6 Passed: Only freeText returns trimmed text');
}

// 7. Conflict detection works for clashing selections
{
  const clashingSelections = {
    timeOfDay: 'midday_sun',
    occasion: 'night_out'
  };
  const conflicts = detectBuildConflicts(clashingSelections);
  assert.ok(conflicts.length > 0, 'Clashing selections must trigger conflicts');
  assert.ok(conflicts[0].message.includes('Night out'), 'Conflict message must explain clash');
  console.log('✓ Test 7 Passed: Conflict detection correctly identifies clashes');
}

// 8. Preset mapper pre-fills build selections
{
  const penthousePreset = presetToBuildSelections('penthouse_birthday');
  assert.strictEqual(penthousePreset.timeOfDay, 'night', 'penthouse_birthday timeOfDay should be night');
  assert.strictEqual(penthousePreset.occasion, 'birthday', 'penthouse_birthday occasion should be birthday');

  const sceneObjPreset = presetToBuildSelections({ id: 'royal_owambe' });
  assert.strictEqual(sceneObjPreset.occasion, 'owambe', 'royal_owambe occasion should be owambe');
  assert.strictEqual(sceneObjPreset.wardrobe, 'aso_ebi_lace', 'royal_owambe wardrobe should be aso_ebi_lace');

  console.log('✓ Test 8 Passed: Preset to build selections mapped correctly');
}

// 9. Verify prompt fragment word counts (all 15-25 words max, no face/skin/body descriptions)
{
  for (const step of BUILD_STEPS) {
    for (const opt of step.options) {
      const words = opt.promptFragment.trim().split(/\s+/);
      assert.ok(
        words.length <= 25, 
        `Option ${step.id}.${opt.id} has ${words.length} words (max allowed: 25)`
      );
      assert.ok(
        !/\b(face|skin tone|skin texture|complexion)\b/i.test(opt.promptFragment),
        `Option ${step.id}.${opt.id} must never describe face or skin`
      );
    }
  }
  console.log('✓ Test 9 Passed: All prompt fragments adhere to word count & face/skin exclusion rules');
}

console.log('🎉 All buildSteps unit tests passed successfully!');
