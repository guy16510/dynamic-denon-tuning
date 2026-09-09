import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopology } from '../src/calibration/topology.js';

test('read-only topology observations remain non-authoritative until hardware-validated', () => {
  const result = detectTopology({ speakerConfig: { FL: 'FL', FR: 'FR', TFL: 'TFL' } });
  assert.equal(result.source, 'denon-read-only-inspection');
  assert.equal(result.confidence, 'medium');
  assert.deepEqual(result.channels, []);
  assert.deepEqual(result.detectedChannels, ['FL', 'FR', 'TFL']);
  assert.ok(result.blockers.some(value => value.includes('Supply explicit channels')));
  assert.equal(result.protectedSettingsReadOnly, true);
});

test('known explicit channels produce a high-confidence user-provided topology', () => {
  const result = detectTopology({}, ['FL', 'FR', 'C', 'TFL', 'TFR', 'SW1']);
  assert.equal(result.source, 'user-provided');
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.channels, ['FL', 'FR', 'C', 'TFL', 'TFR', 'SW1']);
  assert.deepEqual(result.blockers, []);
});
