import test from 'node:test';
import assert from 'node:assert/strict';
import { DenonAdapter, parseDenonStatus, normalizeSpeakerPresetStatus } from '../src/adapters/denon.js';

const baseConfig = {
  host: '192.168.2.8',
  port: 23,
  shieldInput: 'MPLAY',
  measurementVolumeDb: -30,
  allowWrites: false
};

function evoWithResponses(responses) {
  return {
    config: {},
    async call(tool) {
      if (tool === 'denon_status') return { responses };
      throw new Error(`unexpected tool ${tool}`);
    }
  };
}

test('parseDenonStatus decodes the live safety fields', () => {
  const parsed = parseDenonStatus({ responses: ['PWON', 'MV50', 'MUOFF', 'SIMPLAY', 'MSDOLBY ATMOS'] });
  assert.deepEqual(parsed.state, {
    power: 'on',
    input: 'MPLAY',
    mute: false,
    volumeDb: -30,
    soundMode: 'DOLBY ATMOS'
  });
});

test('parseDenonStatus handles half-decibel master volume', () => {
  const parsed = parseDenonStatus({ responses: ['MV505'] });
  assert.equal(parsed.state.volumeDb, -29.5);
});

test('audible preflight passes only when live input, mute and volume are safe', async () => {
  const denon = new DenonAdapter(baseConfig, evoWithResponses(['PWON', 'MV50', 'MUOFF', 'SIMPLAY']));
  const result = await denon.preflightAudibleTest();
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test('audible preflight rejects a wrong input and louder live volume', async () => {
  const denon = new DenonAdapter(baseConfig, evoWithResponses(['PWON', 'MV60', 'MUOFF', 'SIGAME']));
  const result = await denon.preflightAudibleTest();
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(value => value.includes('expected MPLAY')));
  assert.ok(result.blockers.some(value => value.includes('louder than')));
});

test('Speaker Preset normalization accepts one explicit recognized value', () => {
  const result = normalizeSpeakerPresetStatus({ status: { activeSpeakerPreset: 'Preset 2' } });
  assert.equal(result.activeSpeakerPreset, 2);
  assert.equal(result.confidence, 'high');
});

test('Speaker Preset normalization fails closed on conflicting evidence', () => {
  const result = normalizeSpeakerPresetStatus({ activeSpeakerPreset: 1, status: { speakerPreset: 2 } });
  assert.equal(result.activeSpeakerPreset, null);
  assert.equal(result.confidence, 'insufficient');
  assert.match(result.blocker, /Conflicting Speaker Preset evidence/);
});

test('Speaker Preset normalization does not guess from unrelated numbers or text', () => {
  const result = normalizeSpeakerPresetStatus({ activeZone: 2, description: 'Speaker preset information available elsewhere' });
  assert.equal(result.activeSpeakerPreset, null);
  assert.equal(result.confidence, 'insufficient');
});

test('Atmos verification requires parsed live sound mode, not an unrelated raw payload mention', async () => {
  const denon = new DenonAdapter(baseConfig, evoWithResponses(['PWON', 'MV50', 'MUOFF', 'SIMPLAY', 'MSDOLBY DIGITAL']));
  denon.status = async () => ({
    state: { power: 'on', input: 'MPLAY', mute: false, volumeDb: -30, soundMode: 'DOLBY DIGITAL' },
    raw: { note: 'receiver supports ATMOS' },
    lines: ['MSDOLBY DIGITAL']
  });
  const result = await denon.verifyAtmos({ timeoutMs: 1, pollMs: 1 });
  assert.equal(result.verified, false);
  assert.equal(result.soundMode, 'DOLBY DIGITAL');
});

test('Atmos verification passes when parsed live sound mode reports Atmos', async () => {
  const denon = new DenonAdapter(baseConfig, evoWithResponses([]));
  denon.status = async () => ({
    state: { soundMode: 'DOLBY ATMOS' },
    lines: ['MSDOLBY ATMOS']
  });
  const result = await denon.verifyAtmos({ timeoutMs: 1, pollMs: 1 });
  assert.equal(result.verified, true);
  assert.equal(result.soundMode, 'DOLBY ATMOS');
});
