import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCandidates } from '../src/calibration/candidate.js';

test('candidate tie breaking prefers fewer and smaller changes, then lower sequence', () => {
  const candidates = [
    { candidateId: 'c3', measuredScore: 90, sequence: 3, changes: [{ from: 0, to: 2 }] },
    { candidateId: 'c2', measuredScore: 90.01, sequence: 2, changes: [{ from: 0, to: 1 }] },
    { candidateId: 'c1', measuredScore: 90, sequence: 1, changes: [] }
  ];
  candidates.sort((a, b) => compareCandidates(a, b, 0.05));
  assert.equal(candidates[0].candidateId, 'c1');
});
