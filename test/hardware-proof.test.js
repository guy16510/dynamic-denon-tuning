import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HardwareProofService } from '../src/services/hardware-proof-service.js';

async function proofFixture({ microphone = { ready: true } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'denon-proof-'));
  const stimulusPath = join(root, 'TFL.wav');
  await writeFile(stimulusPath, 'not-real-audio');
  let measured = false;
  let micCaptured = false;
  const service = new HardwareProofService({
    denon: { async inspect() { return { presetStatus: { activeSpeakerPreset: 1 } }; } },
    rew: {
      async measurementContract() { return { valid: true, blockers: [], selected: { command: 'SPL', playbackMode: 'From file', measurementMode: 'Single' } }; },
      async inputLevelCheck() { micCaptured = true; return microphone; }
    },
    shield: { async listSweeps() { return ['TFL.wav']; } },
    measurement: {
      async preflight() { return { blockers: [], readyForAudibleMeasurement: true }; },
      async measureChannel() { measured = true; throw new Error('measurement should not run in this fixture'); }
    },
    sessions: { async create() { throw new Error('session should not be created when proof is blocked'); } }
  });
  return { service, stimulusPath, measured: () => measured, micCaptured: () => micCaptured };
}

test('hardware proof remains non-audible until explicitly confirmed', async () => {
  const f = await proofFixture();
  const result = await f.service.run({ channel: 'TFL', fileName: 'TFL.wav', stimulusPath: f.stimulusPath, expectedPreset: 1, confirmAudible: false });
  assert.equal(result.requiresConfirmation, true);
  assert.equal(f.measured(), false);
  assert.equal(f.micCaptured(), false);
});

test('ambiguous microphone result blocks audible proof before measurement', async () => {
  const f = await proofFixture({ microphone: { completed: true } });
  const result = await f.service.run({ channel: 'TFL', fileName: 'TFL.wav', stimulusPath: f.stimulusPath, expectedPreset: 1, confirmAudible: true });
  assert.equal(result.blocked, true);
  assert.equal(result.executed, false);
  assert.match(result.reason, /affirmative usable\/valid\/ready/);
  assert.equal(f.measured(), false);
  assert.equal(f.micCaptured(), true);
});
