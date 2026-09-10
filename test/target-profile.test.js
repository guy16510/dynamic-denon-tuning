import test from 'node:test';
import assert from 'node:assert/strict';
import { lockTargetProfile } from '../src/calibration/target-profile.js';

const profile = { name: 'test', version: 1, seats: [{ position: 0, weight: 1 }], weights: { bassIntegration: .25, crossoverIntegration: .20, timing: .15, frequencyResponse: .15, channelConsistency: .10, seatConsistency: .10, headroom: .05 } };

test('target profile lock is canonical and stable across object key ordering', () => {
  const first = lockTargetProfile(profile);
  const second = lockTargetProfile({ weights: { ...profile.weights }, seats: profile.seats, version: 1, name: 'test' });
  assert.equal(first.sha256, second.sha256);
});

test('target profile rejects objective weights that do not sum to one', () => {
  assert.throws(() => lockTargetProfile({ ...profile, weights: { ...profile.weights, headroom: 0 } }), /sum to 1/);
});
