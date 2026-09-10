import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate } from '../src/calibration/candidate.js';
import { generateCandidateSequence } from '../src/calibration/candidate-generator.js';

const baseline = createCandidate({ candidateId: 'baseline', targetProfileHash: 'abc', distances: { SW1: 4 }, trims: { C: 0 }, crossovers: { C: 80 }, measuredScore: 80 });
const caps = { distance: { min: 3, max: 5, step: 0.5 }, trim: { min: -1, max: 1, step: 0.5 }, crossover: { allowedValues: [60, 80, 100] } };

test('candidate generation is deterministic and constrained to legal receiver values', () => {
  const args = { champion: baseline, targetProfileHash: 'abc', receiverCapabilities: caps, parameterFamilies: [{ kind: 'crossover', key: 'C', values: [100, 80, 55, 60] }, { kind: 'distance', key: 'SW1', values: [4.5, 3.5] }] };
  const first = generateCandidateSequence(args);
  const second = generateCandidateSequence(args);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(item => item.changes[0].to), [60, 100, 3.5, 4.5]);
  assert.ok(first.every(Object.isFrozen));
});
