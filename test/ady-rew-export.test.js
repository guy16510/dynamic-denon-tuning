import test from 'node:test';
import assert from 'node:assert/strict';
import { exportRewImpulse, rewImpulseFilename } from '../src/measurement/rew-impulse-export.js';

test('REW impulse export derives response length and sample interval from source evidence', () => {
  const result = exportRewImpulse({ samples: [0, 0.25, -1, 0.1], sampleRateHz: 48000, channel: 'FHL', position: 1 });
  assert.equal(result.filename, 'TFL-P1.txt');
  assert.equal(result.peakIndex, 2);
  assert.match(result.text, /4 \/\/ Response length/);
  assert.match(result.text, /0\.000020833333333333333 \/\/ Sample interval/);
});

test('REW filenames are deterministic', () => assert.equal(rewImpulseFilename('SW1', 0), 'SW1-P0.txt'));
