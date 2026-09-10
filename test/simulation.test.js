import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSyntheticScenario } from '../src/calibration/simulation.js';

const scenarios = JSON.parse(await readFile(new URL('./fixtures/simulation/scenarios.json', import.meta.url), 'utf8'));

test('offline simulation covers required named synthetic failure/improvement scenarios', () => {
  const required = ['good-integration','bad-crossover-null','sub-delay-error','speaker-delay-error','response-peak','response-dip','seat-inconsistency','mirror-channel-inconsistency','candidate-improvement','candidate-regression'];
  assert.ok(required.every(name => scenarios.some(item => item.name === name && item.synthetic === true)));
});

test('synthetic major regression cannot game aggregate score', async () => {
  const scenario = scenarios.find(item => item.name === 'bad-crossover-null');
  const result = await runSyntheticScenario(scenario);
  assert.equal(result.champion.candidateId, 'baseline');
  assert.equal(result.history[0].reason, 'major-regression');
  assert.equal(result.synthetic, true);
});

test('synthetic replay of the same scenario is deterministic', async () => {
  const scenario = scenarios.find(item => item.name === 'candidate-improvement');
  assert.deepEqual(await runSyntheticScenario(scenario), await runSyntheticScenario(scenario));
});
