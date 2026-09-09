import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementService } from '../src/services/measurement-service.js';

function frequencyTrace() {
  const frequency = Array.from({ length: 120 }, (_, index) => 20 * 2 ** (index / 12));
  return { frequency, magnitude: frequency.map(() => 75), phase: frequency.map(() => 0) };
}

test('automatic file playback waits for configured REW arm delay and uses zero REW start delay', async () => {
  const order = [];
  let requestedStartDelay = null;
  const armMs = 15;
  const startedAt = Date.now();
  const service = new MeasurementService({
    rew: {
      config: { filePlaybackArmDelayMs: armMs },
      async configureFilePlayback() {
        order.push('configured');
        return {
          stimulus: '/tmp/TFL.wav',
          playbackMode: 'From file',
          measurementMode: 'Single',
          contract: { selected: { command: 'SPL', playbackMode: 'From file', measurementMode: 'Single' } }
        };
      },
      async startMeasurement(args) {
        requestedStartDelay = args.startDelaySeconds;
        order.push('rew-start');
        return { started: true, manualRequired: false, beforeMeasurementKeys: ['old'] };
      },
      async waitForNewMeasurement() { order.push('rew-result'); return { id: 'uuid-1', summary: { uuid: 'uuid-1' } }; },
      async trace(id, kind) { return kind === 'frequency-response' ? frequencyTrace() : { data: {} }; }
    },
    shield: {
      async playSweep() {
        order.push('shield-play');
        assert.ok(Date.now() - startedAt >= armMs - 2);
        return { started: true };
      },
      async stop() { order.push('shield-stop'); }
    },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() { return { presetStatus: { activeSpeakerPreset: 1 } }; },
      async requireSafeAudibleTest() { order.push('denon-safe'); },
      async verifyAtmos() { return { verified: true }; }
    },
    sessions: {
      async allocateMeasurementAttempt() { return { number: 1, relativePath: 'measurements/position-0/TFL/attempt-001-uuid-1.json' }; },
      async writeJson() { return '/tmp/attempt.json'; },
      async acceptMeasurementAttempt() { return { pointerPath: 'measurements/position-0/TFL/accepted.json' }; },
      async appendEvent() {}
    }
  });

  const result = await service.measureChannel({
    sessionId: 's',
    position: 0,
    channel: 'TFL',
    shieldFile: 'TFL.wav',
    stimulusPath: '/tmp/TFL.wav',
    expectedPreset: 1,
    measurementType: 'hardware-proof'
  });

  assert.equal(requestedStartDelay, 0);
  assert.equal(result.record.acceptedForOptimization, true);
  assert.equal(result.record.playbackArm.mode, 'automatic-delay');
  assert.equal(result.record.playbackArm.delayMs, armMs);
  assert.ok(order.indexOf('rew-start') < order.indexOf('shield-play'));
  assert.ok(order.indexOf('shield-play') < order.indexOf('rew-result'));
});
