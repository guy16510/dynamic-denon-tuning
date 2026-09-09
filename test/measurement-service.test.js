import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementService } from '../src/services/measurement-service.js';

const SETTINGS = {
  command: 'SPL',
  playbackMode: 'From file',
  measurementMode: 'Single',
  stimulus: '/tmp/TFL.wav'
};

function sessionsFixture() {
  let accepted = 0;
  return {
    value: {
      async allocateMeasurementAttempt() { return { number: 1, relativePath: 'measurements/position-0/TFL/attempt-001-uuid-1.json' }; },
      async writeJson() { return '/tmp/measurement.json'; },
      async acceptMeasurementAttempt() { accepted += 1; return { pointerPath: 'measurements/position-0/TFL/accepted.json' }; },
      async appendEvent() {}
    },
    accepted: () => accepted
  };
}

test('measurement preflight reports independent blockers instead of throwing on first missing component', async () => {
  const service = new MeasurementService({
    rew: {
      async status() { return { contract: { valid: true } }; },
      async detectAutoMeasureCapability() { return { automated: false, mode: 'manual' }; }
    },
    shield: { async status() { throw new Error('adb unavailable'); } },
    denon: { async preflightAudibleTest() { return { ready: false, blockers: ['Receiver is muted.'] }; } },
    sessions: {}
  });
  const result = await service.preflight();
  assert.equal(result.readyForAudibleMeasurement, false);
  assert.ok(result.blockers.some(value => value.includes('adb unavailable')));
  assert.ok(result.blockers.includes('Receiver is muted.'));
});

test('manual capture with a Shield file starts playback before waiting for REW evidence', async () => {
  const order = [];
  const magnitude = Array.from({ length: 120 }, () => 75);
  const sessions = sessionsFixture();
  const service = new MeasurementService({
    rew: {
      async waitForNewMeasurement() { order.push('rew-wait'); return { id: 'uuid-1', summary: { uuid: 'uuid-1' } }; },
      async trace(id, kind) { return kind === 'frequency-response' ? { magnitude, phase: magnitude } : { value: [1, 2, 3] }; }
    },
    shield: {
      async playSweep() { order.push('shield-play'); return { started: true }; },
      async stop() { order.push('shield-stop'); }
    },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() { return { presetStatus: { activeSpeakerPreset: 1 } }; },
      async requireSafeAudibleTest() { order.push('denon-safe'); },
      async verifyAtmos() { order.push('atmos'); return { verified: true }; }
    },
    sessions: sessions.value
  });
  const result = await service.captureManual({
    sessionId: 's1',
    position: 0,
    channel: 'TFL',
    beforeMeasurementKeys: ['old'],
    shieldFile: 'TFL.wav',
    expectedPreset: 1,
    measurementType: 'post-calibration-verification',
    measurementSettings: SETTINGS
  });
  assert.equal(result.record.acceptedForOptimization, true);
  assert.equal(result.record.attempt, 1);
  assert.equal(result.record.preset, 1);
  assert.equal(result.record.expectedPreset, 1);
  assert.deepEqual(result.record.measurementSettings, SETTINGS);
  assert.equal(sessions.accepted(), 1);
  assert.ok(order.indexOf('shield-play') < order.indexOf('rew-wait'));
  assert.ok(order.includes('shield-stop'));
});

test('encoded verification sweep without affirmative Atmos proof is preserved but never accepted', async () => {
  const magnitude = Array.from({ length: 120 }, () => 75);
  const sessions = sessionsFixture();
  const service = new MeasurementService({
    rew: {
      async waitForNewMeasurement() { return { id: 'uuid-1', summary: { uuid: 'uuid-1' } }; },
      async trace(id, kind) { return kind === 'frequency-response' ? { magnitude, phase: magnitude } : { value: [1, 2, 3] }; }
    },
    shield: { async playSweep() { return { started: true }; }, async stop() {} },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() { return { presetStatus: { activeSpeakerPreset: 2 } }; },
      async requireSafeAudibleTest() {},
      async verifyAtmos() { return { verified: null, evidence: 'ambiguous decoder state' }; }
    },
    sessions: sessions.value
  });
  const result = await service.captureManual({
    sessionId: 's1',
    position: 0,
    channel: 'TFL',
    beforeMeasurementKeys: ['old'],
    shieldFile: 'TFL.wav',
    expectedPreset: 2,
    measurementType: 'post-calibration-verification',
    measurementSettings: SETTINGS
  });
  assert.equal(result.record.acceptedForOptimization, false);
  assert.equal(result.record.gate.atmosRequired, true);
  assert.equal(result.record.gate.atmosPassed, false);
  assert.ok(result.record.gate.issues.includes('missing or failed affirmative Atmos verification'));
  assert.equal(sessions.accepted(), 0);
});

test('encoded verification sweep without persisted REW settings is never accepted', async () => {
  const magnitude = Array.from({ length: 120 }, () => 75);
  const sessions = sessionsFixture();
  const service = new MeasurementService({
    rew: {
      async waitForNewMeasurement() { return { id: 'uuid-1', summary: { uuid: 'uuid-1' } }; },
      async trace(id, kind) { return kind === 'frequency-response' ? { magnitude, phase: magnitude } : { value: [1, 2, 3] }; }
    },
    shield: { async playSweep() { return { started: true }; }, async stop() {} },
    denon: {
      config: { shieldInput: 'MPLAY' },
      async inspect() { return { presetStatus: { activeSpeakerPreset: 2 } }; },
      async requireSafeAudibleTest() {},
      async verifyAtmos() { return { verified: true }; }
    },
    sessions: sessions.value
  });
  const result = await service.captureManual({
    sessionId: 's1',
    position: 0,
    channel: 'TFL',
    beforeMeasurementKeys: ['old'],
    shieldFile: 'TFL.wav',
    expectedPreset: 2,
    measurementType: 'post-calibration-verification'
  });
  assert.equal(result.record.acceptedForOptimization, false);
  assert.ok(result.record.gate.issues.some(value => /measurement settings/.test(value)));
  assert.equal(sessions.accepted(), 0);
});
