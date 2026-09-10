import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateTransaction } from '../src/services/candidate-transaction.js';

test('candidate transaction enforces preset protection, measurement evidence, scoring and champion restore order', async () => {
  const calls = [];
  const emitted = [];
  const events = { append: async (_id, type, data) => { emitted.push({ type, data }); return { sequence: emitted.length }; } };
  const champion = { candidateId: 'champion', measuredScore: 80, evaluation: { value: 80, components: [] } };
  const championStore = { current: async () => champion, promote: async (_id, candidate) => candidate };
  const io = {
    snapshot: async () => { calls.push('snapshot'); return {}; },
    verifyPresetProtection: async () => { calls.push('protect'); return { safe: true }; },
    prepare: async () => { calls.push('prepare'); return {}; },
    apply: async () => { calls.push('apply'); return { preset: 2 }; },
    verifyApplied: async () => { calls.push('verify'); return { verified: true }; },
    measure: async () => { calls.push('measure'); return {}; },
    validateEvidence: async () => { calls.push('evidence'); return { valid: true }; },
    score: async () => { calls.push('score'); return { value: 79, components: [] }; },
    restoreChampion: async () => { calls.push('restore'); return { verified: true }; }
  };
  const transaction = new CandidateTransaction({ events, championStore, io });
  const result = await transaction.execute({ sessionId: 's1', candidate: { candidateId: 'candidate-1' } });
  assert.equal(result.accepted, false);
  assert.deepEqual(calls, ['snapshot','protect','prepare','apply','verify','measure','evidence','score','restore']);
  assert.equal(emitted.at(-1).data.restoredChampion, true);
});

test('candidate transaction refuses physical mutation without a candidate ID', async () => {
  const transaction = new CandidateTransaction({ events: {}, championStore: {}, io: {} });
  await assert.rejects(transaction.execute({ sessionId: 's1', candidate: {} }), /candidateId/);
});
