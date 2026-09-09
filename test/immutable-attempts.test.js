import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'denon-attempts-'));
  const sessions = new SessionStore(root);
  const session = await sessions.create({ purpose: 'test' });
  return { root, sessions, session };
}

test('failed and retried attempts are immutable and accepted attempt resolves deterministically', async t => {
  const { root, sessions, session } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await sessions.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-one' });
  const failed = { position: 0, channel: 'TFL', rewId: 'uuid-one', attempt: first.number, capturedAt: '2026-01-01T00:00:00Z', acceptedForOptimization: false };
  await sessions.writeJson(session.id, first.relativePath, failed);

  const second = await sessions.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-two' });
  const accepted = { position: 0, channel: 'TFL', rewId: 'uuid-two', attempt: second.number, capturedAt: '2026-01-01T00:00:01Z', acceptedForOptimization: true };
  await sessions.writeJson(session.id, second.relativePath, accepted);
  await sessions.acceptMeasurementAttempt(session.id, second.relativePath, accepted);

  assert.equal(first.number, 1);
  assert.equal(second.number, 2);
  assert.notEqual(first.relativePath, second.relativePath);

  const all = await sessions.readMeasurementRecords(session.id);
  assert.equal(all.length, 2);
  assert.equal(all[0].acceptedForOptimization, false);
  assert.equal(all[1].acceptedForOptimization, true);

  const acceptedOnly = await sessions.readMeasurementRecords(session.id, { acceptedOnly: true });
  assert.equal(acceptedOnly.length, 1);
  assert.equal(acceptedOnly[0].rewId, 'uuid-two');

  const resolved = await sessions.resolveAcceptedMeasurement(session.id, 0, 'TFL');
  assert.equal(resolved.record.rewId, 'uuid-two');
  assert.equal(resolved.pointer.attempt, 2);
});
