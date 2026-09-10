import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreObjectiveV2, matchedVerificationCapabilities } from '../src/calibration/objective-v2.js';
import { DEFAULT_WEIGHTS } from '../src/calibration/score.js';

const profile = { weights: DEFAULT_WEIGHTS };

test('objective marks headroom unavailable when source cannot prove distortion or compression', () => {
  const metrics = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(key => [key, 90]));
  const score = scoreObjectiveV2({ metrics, capabilities: { frequencyResponse: true, timing: true }, profile });
  assert.equal(score.missingComponents.some(item => item.name === 'headroom'), true);
  assert.equal(score.components.some(item => item.name === 'headroom'), false);
});

test('verification capability comparison rejects pre-correction evidence as physical proof', () => {
  const result = matchedVerificationCapabilities({ frequencyResponse: true, postCorrection: false }, { frequencyResponse: true, postCorrection: false });
  assert.equal(result.matched, true);
  assert.equal(result.physicallyVerifiable, false);
});
