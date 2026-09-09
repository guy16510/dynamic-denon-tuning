import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementService } from '../src/services/measurement-service.js';

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
      async requireSafeAudibleTest() { order.push('denon-safe'); },
      async verifyAtmos() { order.push('atmos'); return { verified: true }; }
    },
    sessions: {
      async allocateMeasurementAttempt() { return { number: 1, relativePath: 'measurements/position-0/TFL/attempt-001-uuid-1.json' }; },
      async writeJson() { return '/tmp/measurement.json'; },
      async acceptMeasurementAttempt() { return { pointerPath: 'measurements/position-0/TFL/accepted.json' }; },
      async appendEvent() {}
    }
  });
  const result = await service.captureManual({
    sessionId: 's1',
    position: 0,
    channel: 'TFL',
    beforeMeasurementKeys: ['old'],
    shieldFile: 'TFL.wav'
  });
  assert.equal(result.record.acceptedForOptimization, true);
  assert.equal(result.record.attempt, 1);
  assert.ok(order.indexOf('shield-play') < order.indexOf('rew-wait'));
  assert.ok(order.includes('shield-stop'));
});
