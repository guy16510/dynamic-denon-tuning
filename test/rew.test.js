import test from 'node:test';
import assert from 'node:assert/strict';
import { RewAdapter, normalizeChoices, selectChoice, decodeFloat32Base64, decodeRewTrace } from '../src/adapters/rew.js';

function float32Base64(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatBE(value, index * 4));
  return bytes.toString('base64');
}

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

test('manual REW mode returns a resumable checkpoint without sending a measurement command', async () => {
  const adapter = new RewAdapter({ url: 'http://127.0.0.1:4735', measurementMode: 'manual' }, {});
  let commandPosted = false;
  adapter.listMeasurements = async () => [{ uuid: 'existing' }];
  adapter.request = async (path, options = {}) => {
    if (path === '/measure/naming') return {};
    if (path === '/measure/command' && options.method === 'POST') commandPosted = true;
    return 'OK';
  };
  const started = await adapter.startMeasurement({ title: 'TFL0', notes: 'manual proof' });
  assert.equal(started.manualRequired, true);
  assert.equal(started.started, false);
  assert.deepEqual(started.beforeMeasurementKeys, ['existing']);
  assert.equal(commandPosted, false);
});

test('REW Pro flow posts the negotiated SPL command automatically', async () => {
  const adapter = new RewAdapter({ url: 'http://127.0.0.1:4735', measurementMode: 'pro' }, {});
  const posts = [];
  adapter.listMeasurements = async () => [{ uuid: 'existing' }];
  adapter.measurementContract = async () => ({ valid: true, selected: { command: 'SPL', playbackMode: 'From file', measurementMode: 'Single' } });
  adapter.request = async (path, options = {}) => {
    if (path === '/measure/naming') return {};
    if (options.method === 'POST') posts.push([path, options.body]);
    return 'OK';
  };
  const started = await adapter.startMeasurement({ title: 'TFL0', notes: 'pro proof' });
  assert.equal(started.started, true);
  assert.equal(started.manualRequired, false);
  assert.equal(started.command, 'SPL');
  assert.ok(posts.some(([path, body]) => path === '/measure/command' && body?.command === 'SPL'));
});

test('REW float arrays decode from big-endian Base64', () => {
  const decoded = decodeFloat32Base64(float32Base64([1.25, -2.5, 72.125]));
  assert.deepEqual(decoded.map(value => Math.round(value * 1000) / 1000), [1.25, -2.5, 72.125]);
});

test('frequency-response decoder reconstructs the frequency axis', () => {
  const decoded = decodeRewTrace('frequency-response', {
    id: 'abc',
    data: {
      startFreq: 20,
      ppo: 1,
      magnitude: float32Base64([70, 71, 72]),
      phase: float32Base64([0, 10, 20])
    }
  });
  assert.deepEqual(decoded.data.frequency.map(value => Math.round(value)), [20, 40, 80]);
  assert.deepEqual(decoded.data.magnitude.map(value => Math.round(value)), [70, 71, 72]);
  assert.equal(decoded.data.decodedFromBase64, true);
});

test('impulse decoder preserves peak timing while bounding stored samples', () => {
  const values = Array.from({ length: 10000 }, () => 0);
  values[4321] = -0.95;
  const decoded = decodeRewTrace('impulse-response', {
    data: {
      startTime: -0.01,
      sampleRate: 48000,
      data: float32Base64(values)
    }
  }, { maxPoints: 500 });
  assert.equal(decoded.data.peakIndex, 4321);
  assert.ok(decoded.data.sampleIndices.includes(4321));
  assert.ok(decoded.data.data.length <= 502);
  assert.ok(Math.abs(decoded.data.peakTimeSeconds - (-0.01 + 4321 / 48000)) < 1e-9);
});
