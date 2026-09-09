import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HardwareProofService } from '../src/services/hardware-proof-service.js';

test('hardware proof remains non-audible until explicitly confirmed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-proof-'));
  const stimulusPath = join(root, 'TFL.wav');
  await writeFile(stimulusPath, 'not-real-audio');
  let measured = false;
  let micCaptured = false;
  const service = new HardwareProofService({
    denon: {},
    rew: {
      async measurementContract() { return { valid: true, blockers: [], selected: { command: 'SPL', playbackMode: 'From file', measurementMode: 'Single' } }; },
      async inputLevelCheck() { micCaptured = true; return { completed: true }; }
    },
    shield: { async listSweeps() { return ['TFL.wav']; } },
    measurement: {
      async preflight() { return { blockers: [], readyForAudibleMeasurement: true }; },
      async measureChannel() { measured = true; throw new Error('should not run'); }
    },
    sessions: {}
  });
  const result = await service.run({ channel: 'TFL', fileName: 'TFL.wav', stimulusPath, confirmAudible: false });
  assert.equal(result.requiresConfirmation, true);
  assert.equal(measured, false);
  assert.equal(micCaptured, false);
});
