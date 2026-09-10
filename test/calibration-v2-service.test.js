import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';
import { LiveEventBus } from '../src/services/live-event-bus.js';
import { V2EventStore } from '../src/services/v2-event-store.js';
import { CalibrationStateMachine } from '../src/services/calibration-state-machine.js';
import { CalibrationV2Service } from '../src/services/calibration-v2-service.js';

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'denon-v2-service-'));
  const sessions = new SessionStore(root); const bus = new LiveEventBus(); const events = new V2EventStore({ sessions, bus });
  const stateMachine = new CalibrationStateMachine({ events });
  const config = { calibration: { profilePath: new URL('../profiles/reference-home-theater.json', import.meta.url).pathname, nativeMeasurement: 'probe' }, denon: { allowWrites: false } };
  return { root, sessions, events, stateMachine, config };
}

test('failed read-only preflight becomes BLOCKED and releases hardware lock', async () => {
  const h = await harness();
  const service = new CalibrationV2Service({ ...h, theater: { inspect: async () => { throw new Error('receiver offline'); } }, denon: {}, shield: {} });
  const created = await service.create();
  const result = await service.start({ sessionId: created.id });
  assert.equal(result.state, 'BLOCKED');
  const second = await service.lock.acquire('other-session');
  assert.equal(second.acquired, true);
});

test('candidate IDs cannot escape candidate artifact namespace', async () => {
  const h = await harness();
  const service = new CalibrationV2Service({ ...h, theater: {}, denon: {}, shield: {} });
  await assert.rejects(service.createCandidateAdy({ sessionId: 'x', candidateId: '../source/original', changes: [] }), /candidateId/);
});
