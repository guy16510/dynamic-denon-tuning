import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNormalizedCapture } from '../tools/audyssey-protocol/analyze-capture.js';
import { compareCaptures } from '../tools/audyssey-protocol/compare-captures.js';

const a = [
  { direction: 'app->avr', srcPort: 5000, dstPort: 6000, length: 4, payloadHex: '00112233' },
  { direction: 'avr->app', srcPort: 6000, dstPort: 5000, length: 4, payloadHex: 'aabbccdd' }
].map(JSON.stringify).join('\n');
const b = [
  { direction: 'app->avr', srcPort: 5000, dstPort: 6000, length: 4, payloadHex: '00112233' },
  { direction: 'avr->app', srcPort: 6000, dstPort: 5000, length: 8, payloadHex: 'aabbccddeeff0011' }
].map(JSON.stringify).join('\n');

test('protocol tooling reports signatures without inventing packet semantics', () => {
  const result = analyzeNormalizedCapture(a);
  assert.equal(result.packetCount, 2);
  assert.equal(result.directions['app->avr'], 1);
  assert.ok(result.signatures.every(item => !('command' in item)));
  assert.ok(compareCaptures(a, b).differences.length >= 2);
});
