import test from 'node:test';
import assert from 'node:assert/strict';
import { replayOptimization } from '../src/calibration/replay.js';

test('offline replay produces the same candidate sequence, champion and digest', async () => {
  const baseline = { candidateId: 'baseline', measuredScore: 80, sequence: 0, changes: [] };
  const candidates = [
    { candidateId: 'candidate-0001', sequence: 1, changes: [{ from: 60, to: 80 }] },
    { candidateId: 'candidate-0002', sequence: 2, changes: [{ from: 80, to: 100 }] }
  ];
  const args = { measurementHashes: ['b', 'a'], targetProfileHash: 'profile', baseline, candidates, evaluations: { 'candidate-0001': { score: 82 }, 'candidate-0002': { score: 81 } } };
  const first = await replayOptimization(args);
  const second = await replayOptimization(args);
  assert.equal(first.deterministicDigest, second.deterministicDigest);
  assert.equal(first.champion.candidateId, 'candidate-0001');
  assert.deepEqual(first.history, second.history);
});
