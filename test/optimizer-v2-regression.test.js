import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidateAcceptance } from '../src/calibration/acceptance-v2.js';
import { runDeterministicOptimization } from '../src/calibration/optimizer-v2.js';

const objective = (value, components) => ({ value, components: Object.entries(components || {}).map(([name, score]) => ({ name, score })) });

test('aggregate improvement loses when one measured component has a major regression', () => {
  const result = assessCandidateAcceptance({ measuredScore: 80, evaluation: objective(80, { timing: 90, frequencyResponse: 85 }) }, { measuredScore: 83, evaluation: objective(83, { timing: 75, frequencyResponse: 95 }) }, { defaultMajorRegression: 8 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'major-regression');
  assert.equal(result.regressions[0].name, 'timing');
});

test('illegal higher-scoring candidate is rejected before evaluator/hardware work', async () => {
  let evaluated = 0;
  const result = await runDeterministicOptimization({ baseline: { candidateId: 'baseline', measuredScore: 80 }, candidates: [{ candidateId: 'bad', sequence: 1, legal: false }], constraints: { validate: candidate => candidate.legal === false ? ['illegal crossover'] : [] }, evaluate: async () => { evaluated += 1; return { value: 99 }; } });
  assert.equal(evaluated, 0);
  assert.equal(result.history[0].reason, 'constraint');
});

test('improvement below epsilon does not become champion', async () => {
  const result = await runDeterministicOptimization({ baseline: { candidateId: 'baseline', measuredScore: 80 }, candidates: [{ candidateId: 'tiny', sequence: 1 }], epsilon: 0.05, evaluate: async () => ({ value: 80.01 }) });
  assert.equal(result.champion.candidateId, 'baseline');
  assert.equal(result.history[0].reason, 'below-epsilon');
});
