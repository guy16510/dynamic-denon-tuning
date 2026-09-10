import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';

test('session artifacts are append-only unless overwrite is explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create({ purpose: 'test' });
  const first = await store.writeJson(session.id, 'baseline/test.json', { value: 1 });
  await assert.rejects(() => store.writeJson(session.id, 'baseline/test.json', { value: 2 }), /refusing to overwrite/);
  await store.writeJson(session.id, 'baseline/test.json', { value: 2 }, { overwrite: true });
  assert.equal(JSON.parse(await readFile(first, 'utf8')).value, 2);
});

test('copyArtifact refuses to overwrite raw session evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create({ purpose: 'test' });
  const source = join(root, 'source.txt');
  await writeFile(source, 'raw evidence');
  await store.copyArtifact(session.id, source, 'measurements/raw.txt');
  await assert.rejects(() => store.copyArtifact(session.id, source, 'measurements/raw.txt'), /refusing to overwrite/);
});

test('session path traversal is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create();
  assert.throws(() => store.path(session.id, '../../outside'), /escapes session root/);
});

test('measurement records can be read back in deterministic position/channel order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create();
  await store.writeJson(session.id, 'measurements/position-1/FR.json', { position: 1, channel: 'FR' });
  await store.writeJson(session.id, 'measurements/position-0/FL.json', { position: 0, channel: 'FL' });
  await store.writeJson(session.id, 'measurements/position-0/FR.json', { position: 0, channel: 'FR' });
  const records = await store.readMeasurementRecords(session.id);
  assert.deepEqual(records.map(record => `${record.position}:${record.channel}`), ['0:FL', '0:FR', '1:FR']);
});

test('accepted attempt pointer is immutable once selected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create();
  const first = await store.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-1' });
  const firstRecord = { position: 0, channel: 'TFL', rewId: 'uuid-1', attempt: first.number };
  await store.writeJson(session.id, first.relativePath, firstRecord);
  await store.acceptMeasurementAttempt(session.id, first.relativePath, firstRecord);

  const second = await store.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-2' });
  const secondRecord = { position: 0, channel: 'TFL', rewId: 'uuid-2', attempt: second.number };
  await store.writeJson(session.id, second.relativePath, secondRecord);
  await assert.rejects(
    () => store.acceptMeasurementAttempt(session.id, second.relativePath, secondRecord),
    /refusing to overwrite session artifact.*accepted\.json/
  );

  const resolved = await store.resolveAcceptedMeasurement(session.id, 0, 'TFL');
  assert.equal(resolved.record.rewId, 'uuid-1');
  assert.equal(resolved.record.attempt, 1);
  assert.match(resolved.pointer.recordSha256, /^[a-f0-9]{64}$/);
});

test('accepted record content tampering fails digest verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create();
  const attempt = await store.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-1' });
  const record = { position: 0, channel: 'TFL', rewId: 'uuid-1', attempt: attempt.number, scoreRelevantValue: 1 };
  await store.writeJson(session.id, attempt.relativePath, record);
  await store.acceptMeasurementAttempt(session.id, attempt.relativePath, record);

  await writeFile(store.path(session.id, attempt.relativePath), `${JSON.stringify({ ...record, scoreRelevantValue: 99 }, null, 2)}\n`);
  await assert.rejects(() => store.resolveAcceptedMeasurement(session.id, 0, 'TFL'), /record digest mismatch/);
  await assert.rejects(() => store.readMeasurementRecords(session.id, { acceptedOnly: true }), /record digest mismatch/);
});

test('accepted pointer without digest fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'denon-session-'));
  const store = new SessionStore(root);
  const session = await store.create();
  const attempt = await store.allocateMeasurementAttempt(session.id, { position: 0, channel: 'TFL', rewId: 'uuid-1' });
  const record = { position: 0, channel: 'TFL', rewId: 'uuid-1', attempt: attempt.number };
  await store.writeJson(session.id, attempt.relativePath, record);
  await store.writeJson(session.id, 'measurements/position-0/TFL/accepted.json', {
    schemaVersion: 1,
    acceptedAt: new Date().toISOString(),
    position: 0,
    channel: 'TFL',
    rewId: 'uuid-1',
    attempt: 1,
    recordPath: attempt.relativePath
  });
  await assert.rejects(() => store.resolveAcceptedMeasurement(session.id, 0, 'TFL'), /missing record digest/);
});
