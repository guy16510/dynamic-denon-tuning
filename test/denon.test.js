import test from 'node:test';
import assert from 'node:assert/strict';
import { DenonAdapter, parseDenonStatus } from '../src/adapters/denon.js';

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
