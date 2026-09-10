import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { LiveEventBus } from '../src/services/live-event-bus.js';
import { createDashboardServer } from '../src/dashboard/server.js';

test('dashboard exposes safe system status and calibration command API', async t => {
  const bus = new LiveEventBus();
  const service = {
    listSessions: async () => [],
    create: async () => ({ id: 'session-1' }),
    start: async ({ sessionId }) => ({ id: sessionId, state: 'BLOCKED' }),
    status: async id => ({ id, state: 'BLOCKED', champion: null }),
    eventsFor: async () => [], measurementsFor: async () => [], candidatesFor: async () => [],
    pause: async ({ sessionId }) => ({ id: sessionId, state: 'PAUSED' }), resume: async ({ sessionId }) => ({ id: sessionId, state: 'PREFLIGHT' }), abort: async ({ sessionId }) => ({ id: sessionId, state: 'ABORTED' }), applyBest: async () => ({ applied: false, blocked: true })
  };
  const config = { denon: { allowWrites: false }, calibration: { nativeMeasurement: 'probe' } };
  const theater = { inspect: async () => ({ receiver: 'Denon AVR-X3700H' }) };
  const server = createDashboardServer({ config, service, theater, bus, staticDir: '/nonexistent' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const system = await fetch(`http://127.0.0.1:${port}/api/system`).then(r => r.json());
  assert.equal(system.receiverWritesEnabled, false);
  assert.equal(system.productMode, 'guided-automatic-calibration');
  const started = await fetch(`http://127.0.0.1:${port}/api/calibration/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
  assert.deepEqual(started, { id: 'session-1', state: 'BLOCKED' });
});
