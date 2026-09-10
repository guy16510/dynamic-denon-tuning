import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementService } from '../src/services/measurement-service.js';

function frequencyTrace() {
  const frequency = Array.from({ length: 120 }, (_, index) => 20 * 2 ** (index / 12));
  return { frequency, magnitude: frequency.map(() => 75), phase: frequency.map(() => 0) };
}

function rewFixture(armMs, order) {
  return {
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
      order.push('rew-start');
      return { started: true, manualRequired: false, beforeMeasurementKeys: ['old'], requestedStartDelay: args.startDelaySeconds };
    },
    async waitForNewMeasurement() { order.push('rew-result'); return { id: 'uuid-1', summary: { uuid: 'uuid-1' } }; },
    async trace(id, kind) { return kind === 'frequency-response' ? frequencyTrace() : { data: {} }; }
  };
}

function sessionsFixture(events = []) {
  return {
    async allocateMeasurementAttempt() { return { number: 1, relativePath: 'measurements/position-0/TFL/attempt-001-uuid-1.json' }; },
    async writeJson() { return '/tmp/attempt.json'; },
    async acceptMeasurementAttempt() { return { pointerPath: 'measurements/position-0/TFL/accepted.json' }; },
    async appendEvent(sessionId, type, data) { events.push({ type, data }); }
  };
}

test('automatic file playback waits for configured REW arm delay and rechecks safety immediately before Shield launch', async () => {
  const order = [];
  let safetyChecks = 0;
  let startDelay = null;
  const armMs = 15;
  const startedAt = Date.now();
  const rew = rewFixture(armMs, order);
  const originalStart = rew.startMeasurement;
  rew.startMeasurement = async args => {
    startDelay = args.startDelaySeconds;
    return originalStart(args);
  };
  const service = new MeasurementService({
    rew,
    shield: {
      async playSweep() {
        order.push('shield-play');
        assert.ok(Date.now() - startedAt >= armMs - 2);
        assert.equal(safetyChecks, 2);
        return { started: true };
      },
      async stop() { order.push('shield-stop'); }
    },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() { return { presetStatus: { activeSpeakerPreset: 1 } }; },
      async requireSafeAudibleTest() { safetyChecks += 1; order.push(`denon-safe-${safetyChecks}`); return { ready: true }; },
      async verifyAtmos() { return { verified: true }; }
    },
    sessions: sessionsFixture()
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

  assert.equal(startDelay, 0);
  assert.equal(result.record.acceptedForOptimization, true);
  assert.equal(result.record.playbackArm.mode, 'automatic-delay');
  assert.equal(result.record.playbackArm.delayMs, armMs);
  assert.ok(order.indexOf('rew-start') < order.indexOf('denon-safe-2'));
  assert.ok(order.indexOf('denon-safe-2') < order.indexOf('shield-play'));
  assert.ok(order.indexOf('shield-play') < order.indexOf('rew-result'));
});

test('receiver preset change during REW arm window blocks Shield audio and requires REW cancellation', async () => {
  const order = [];
  const events = [];
  let inspections = 0;
  let played = false;
  const service = new MeasurementService({
    rew: rewFixture(1, order),
    shield: {
      async playSweep() { played = true; throw new Error('must not play'); },
      async stop() {}
    },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() {
        inspections += 1;
        return { presetStatus: { activeSpeakerPreset: inspections === 1 ? 1 : 2 } };
      },
      async requireSafeAudibleTest() { return { ready: true }; }
    },
    sessions: sessionsFixture(events)
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

  assert.equal(result.blocked, true);
  assert.equal(result.wrongPreset, true);
  assert.equal(result.activePreset, 2);
  assert.equal(result.rewMeasurementMayBeArmed, true);
  assert.match(result.manualAction, /Cancel the pending measurement in REW/);
  assert.equal(played, false);
  assert.ok(events.some(event => event.type === 'measurement.pre-play-context-changed'));
});
