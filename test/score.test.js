import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCalibration } from '../src/calibration/score.js';
import { compareScores } from '../src/calibration/compare.js';

const baselineMetrics = {
  bassIntegration: 70,
  crossoverIntegration: 72,
  timing: 80,
  frequencyResponse: 68,
  channelConsistency: 82,
  seatConsistency: 66,
  headroom: 90
};

test('scoreCalibration uses all weighted components and returns high confidence', () => {
  const scored = scoreCalibration(baselineMetrics);
  assert.equal(scored.confidence, 'high');
  assert.equal(scored.evidenceWeight, 1);
  assert.equal(scored.components.length, 7);
  assert.ok(scored.score > 0 && scored.score <= 100);
});

test('missing evidence lowers score confidence', () => {
  const scored = scoreCalibration({ bassIntegration: 90, timing: 90 });
  assert.equal(scored.confidence, 'low');
  assert.equal(scored.evidenceWeight, 0.4);
});

test('candidate is accepted only with measured gain and no major regression', () => {
  const baseline = scoreCalibration(baselineMetrics);
  const candidate = scoreCalibration(Object.fromEntries(Object.entries(baselineMetrics).map(([key, value]) => [key, value + 5])));
  const compared = compareScores(baseline, candidate);
  assert.equal(compared.accepted, true);
  assert.ok(compared.overallDelta >= 0.5);
  assert.equal(compared.regressions.length, 0);
});

test('major component regression rejects a candidate even when aggregate score improves', () => {
  const baseline = scoreCalibration(baselineMetrics);
  const candidate = scoreCalibration({
    ...baselineMetrics,
    bassIntegration: 100,
    crossoverIntegration: 100,
    timing: 68
  });
  const compared = compareScores(baseline, candidate);
  assert.equal(compared.accepted, false);
  assert.ok(compared.regressions.some(item => item.name === 'timing'));
});
