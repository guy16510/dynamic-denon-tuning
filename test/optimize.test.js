import test from 'node:test';
import assert from 'node:assert/strict';
import { crossoverCandidates, proposeDelayAdjustment } from '../src/calibration/optimize.js';

test('crossover candidates are bounded to standard AVR values and measured extension', () => {
  const values = crossoverCandidates({ f3Hz: 68, currentHz: 80, role: 'center' });
  assert.ok(values.includes(100));
  assert.ok(values.every(value => value >= 100));
  assert.ok(values.length <= 5);
});

test('height speaker candidates do not suggest unsafe low crossovers', () => {
  const values = crossoverCandidates({ f3Hz: 55, currentHz: 80, role: 'top_front_left' });
  assert.ok(values.every(value => value >= 80));
});

test('delay proposal converts measured milliseconds to an equivalent distance adjustment', () => {
  const proposal = proposeDelayAdjustment({ measuredOffsetMs: 1, currentDistanceMeters: 3 });
  assert.equal(proposal.measuredOffsetMs, 1);
  assert.ok(Math.abs(proposal.equivalentDistanceMeters - 0.343) < 0.001);
  assert.ok(proposal.candidateDistanceMeters > 3.34 && proposal.candidateDistanceMeters < 3.35);
  assert.match(proposal.rule, /re-measure/i);
});
