import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdyText } from '../src/adapters/audyssey-ady.js';
import { measurementsFromAudyssey } from '../src/measurement/audyssey-measurement-source.js';
import { requireCapabilities } from '../src/measurement/measurement-model.js';

test('Audyssey ResponseData becomes capability-honest canonical measurements', () => {
  const parsed = parseAdyText(JSON.stringify({ DetectedChannels: [{ ChannelType: 'FL', ResponseData: [[0, 1, 0]] }] }));
  const [measurement] = measurementsFromAudyssey(parsed);
  assert.equal(measurement.channel, 'FL');
  assert.equal(measurement.capabilities.impulseResponse, true);
  assert.equal(measurement.capabilities.postCorrection, false);
  assert.deepEqual(requireCapabilities(measurement, ['impulseResponse', 'postCorrection']), { available: false, missing: ['postCorrection'] });
  assert.ok(Object.isFrozen(measurement));
});
