import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdyText, createAdyCandidate } from '../src/adapters/audyssey-ady.js';

const original = { UnknownRoot: { keep: true }, detectedChannels: [{ channelType: 'C', CustomCrossover: 60, Mystery: 'preserve', responseData: [[0, 1, 0]] }] };

test('candidate ady changes one known field while preserving unknown fields and ResponseData', () => {
  const parsed = parseAdyText(JSON.stringify(original));
  const candidate = createAdyCandidate(parsed, [{ channel: 'C', field: 'customCrossover', value: 80, reason: 'measured search' }], { candidateId: 'candidate-0001' });
  const reparsed = JSON.parse(candidate.text);
  assert.equal(reparsed.detectedChannels[0].CustomCrossover, 80);
  assert.equal(reparsed.detectedChannels[0].Mystery, 'preserve');
  assert.deepEqual(reparsed.detectedChannels[0].responseData, original.detectedChannels[0].responseData);
  assert.deepEqual(reparsed.UnknownRoot, original.UnknownRoot);
  assert.equal(candidate.diffs[0].from, 60);
  assert.equal(candidate.diffs[0].to, 80);
});
