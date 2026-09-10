import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';
import { LiveEventBus } from '../src/services/live-event-bus.js';
import { V2EventStore } from '../src/services/v2-event-store.js';

test('V2 events persist in sequence and publish the same authoritative event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-v2-events-'));
  const sessions = new SessionStore(root);
  const session = await sessions.create();
  const bus = new LiveEventBus();
  const published = [];
  bus.subscribe(event => published.push(event));
  const events = new V2EventStore({ sessions, bus });
  await Promise.all([events.append(session.id, 'one', { n: 1 }), events.append(session.id, 'two', { n: 2 })]);
  const stored = await events.read(session.id);
  assert.deepEqual(stored.map(event => event.sequence), [1, 2]);
  assert.deepEqual(published, stored);
});
