import test from 'node:test';
import assert from 'node:assert/strict';
import { buildV2Report } from '../src/calibration/report-v2.js';

test('V2 report makes missing post-correction verification impossible to miss', () => {
  const report = buildV2Report({ session: { id: 's1', receiver: 'Denon AVR-X3700H' }, measurementCapability: { state: 'pre-correction-only', postCorrection: false }, champion: { candidateId: 'c1', measuredScore: 91, score: { components: [], missingComponents: [{ name: 'headroom', reason: 'unavailable' }], confidence: 'medium' } } });
  assert.equal(report.json.physicalPostCorrectionVerified, false);
  assert.match(report.markdown, /NOT AVAILABLE \/ NOT VERIFIED/);
  assert.match(report.markdown, /HEADROOM|headroom/i);
});
