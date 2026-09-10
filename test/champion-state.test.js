import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';
import { LiveEventBus } from '../src/services/live-event-bus.js';
import { V2EventStore } from '../src/services/v2-event-store.js';
import { ChampionStore } from '../src/services/champion-store.js';

test('champion changes are projected to disk and preserved as immutable events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'champion-v2-'));
  const sessions = new SessionStore(root); const session = await sessions.create();
  const events = new V2EventStore({ sessions, bus: new LiveEventBus() });
  const store = new ChampionStore({ sessions, events });
  await store.initialize(session.id, { candidateId: 'baseline', measuredScore: 80 });
  await assert.rejects(store.promote(session.id, { candidateId: 'bad', measuredScore: 90 }, { accepted: false }), /rejected/);
  const promoted = await store.promote(session.id, { candidateId: 'candidate-0001', measuredScore: 82 }, { accepted: true, reason: 'measured-improvement', delta: 2 });
  assert.equal(promoted.candidateId, 'candidate-0001');
  const history = await events.read(session.id);
  assert.deepEqual(history.filter(event => event.type === 'champion.changed').map(event => event.data.to), ['baseline', 'candidate-0001']);
});
