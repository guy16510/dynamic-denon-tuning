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
