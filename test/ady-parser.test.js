import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdyText } from '../src/adapters/audyssey-ady.js';

const source = JSON.stringify({ TargetModelName: 'AVR-X3700H', MultEQType: 'XT32', DetectedChannels: [{ ChannelType: 'FL', CustomDistance: 3.2, ResponseData: [[0, 0.1, 1, 0.1]] }, { commandId: 'SW1', responseData: [{ position: 2, samples: [0, -1, 0] }] }] });

test('Audyssey parser accepts observed casing variants and records immutable source metadata', () => {
  const parsed = parseAdyText(source, { sourceFilename: 'fixture.ady', importedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(parsed.metadata.receiverModel, 'AVR-X3700H');
  assert.equal(parsed.metadata.sampleRateHz, 48000);
  assert.equal(parsed.metadata.sampleRateSource, 'audyssey-format-assumption');
  assert.equal(parsed.channels[0].id, 'FL');
  assert.equal(parsed.channels[1].responses[0].position, 2);
  assert.match(parsed.metadata.sourceSha256, /^[a-f0-9]{64}$/);
});

test('Audyssey parser rejects malformed response data rather than manufacturing evidence', () => {
  assert.throws(() => parseAdyText(JSON.stringify({ DetectedChannels: [{ ChannelType: 'FL', ResponseData: [] }] })), /ResponseData/);
});
