import test from 'node:test';
import assert from 'node:assert/strict';
import { RewAdapter, normalizeChoices, selectChoice } from '../src/adapters/rew.js';

test('choice helpers support current and wrapper-shaped REW responses', () => {
  assert.deepEqual(normalizeChoices({ choices: ['Single', 'Repeated'] }), ['Single', 'Repeated']);
  assert.equal(selectChoice(['REW playback', 'From file'], [/^from\s+file$/i]), 'From file');
});

test('measurement contract separates SPL command from Single measurement mode', async () => {
  const adapter = new RewAdapter({ url: 'http://127.0.0.1:4735', measurementMode: 'pro' }, {});
  adapter.request = async path => {
    if (path === '/measure/commands') return ['SPL', 'Impedance'];
    if (path === '/measure/playback-mode/choices') return ['From REW', 'From file'];
    if (path === '/measure/measurement-mode/choices') return ['Single', 'Repeated', 'Ramped', 'Sequential'];
    throw new Error(path);
  };
  const contract = await adapter.measurementContract();
  assert.equal(contract.valid, true);
  assert.deepEqual(contract.selected, {
    command: 'SPL',
    playbackMode: 'From file',
    measurementMode: 'Single'
  });
});

test('configureFilePlayback posts negotiated values instead of using SPL as the mode', async () => {
  const adapter = new RewAdapter({ url: 'http://127.0.0.1:4735', measurementMode: 'pro' }, {});
  const state = {};
  const posts = [];
  adapter.request = async (path, options = {}) => {
    if (path === '/measure/commands') return ['SPL'];
    if (path === '/measure/playback-mode/choices') return ['From REW', 'From file'];
    if (path === '/measure/measurement-mode/choices') return ['Single', 'Repeated'];
    if (options.method === 'POST') {
      posts.push([path, options.body]);
      state[path] = options.body;
      return 'OK';
    }
    return state[path];
  };
  const result = await adapter.configureFilePlayback({ stimulusPath: '/tmp/TFL.wav' });
  assert.equal(result.verified, true);
  assert.ok(posts.some(([path, body]) => path === '/measure/measurement-mode' && body === 'Single'));
  assert.ok(!posts.some(([path, body]) => path === '/measure/measurement-mode' && body === 'SPL'));
});

test('new measurements use stable REW UUIDs when available', async () => {
  const adapter = new RewAdapter({ url: 'http://127.0.0.1:4735', measurementMode: 'manual' }, {});
  adapter.listMeasurements = async () => [
    { uuid: 'old', name: 'old' },
    { uuid: 'new-uuid', name: 'new' }
  ];
  const captured = await adapter.captureNewMeasurement({ beforeMeasurementKeys: ['old'] });
  assert.equal(captured.id, 'new-uuid');
});
