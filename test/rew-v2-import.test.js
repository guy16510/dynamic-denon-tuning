import test from 'node:test';
import assert from 'node:assert/strict';
import { RewV2Adapter, encodeFloat32Base64 } from '../src/adapters/rew-v2.js';
import { decodeFloat32Base64 } from '../src/adapters/rew.js';

test('REW V2 impulse data encoder round-trips Float32 big-endian samples', () => {
  const source = [0, 0.25, -1, 0.125];
  const encoded = encodeFloat32Base64(source);
  assert.deepEqual(decodeFloat32Base64(encoded), source);
});

test('REW V2 uses documented impulse-response-data import endpoint and waits for generated measurement', async () => {
  const requests = [];
  const adapter = new RewV2Adapter({ url: 'http://rew', measurementMode: 'auto' }, {});
  adapter.measurementKeys = async () => ['before'];
  adapter.request = async (path, options) => { requests.push({ path, options }); return { accepted: true }; };
  adapter.waitForNewMeasurement = async ({ beforeMeasurementKeys }) => ({ id: 'after', beforeMeasurementKeys });
  const result = await adapter.importImpulseResponseData({ identifier: 'FL-P0', samples: [0, 1, 0], sampleRateHz: 48000 });
  assert.equal(requests[0].path, '/import/impulse-response-data');
  assert.equal(requests[0].options.body.sampleRate, 48000);
  assert.equal(requests[0].options.body.applyCal, false);
  assert.equal(result.measurement.id, 'after');
});
