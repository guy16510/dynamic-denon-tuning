import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NexusAdapter } from '../src/adapters/nexus.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nexus-'));
  const baseline = join(root, 'baseline.ady');
  await writeFile(baseline, '{"seed":"calibration"}');
  return { root, baseline, adapter: new NexusAdapter({ command: null }) };
}

test('Nexus prepare creates immutable handoff and input artifacts', async () => {
  const { root, baseline, adapter } = await fixture();
  const prepared = await adapter.prepare({ sessionRoot: root, baselineAdy: baseline, measurements: [{ channel: 'TFL' }] });
  assert.equal(prepared.prepared, true);
  const manifest = JSON.parse(await readFile(prepared.manifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.ok(manifest.baselineBytes > 0);
  await assert.rejects(
    () => adapter.prepare({ sessionRoot: root, baselineAdy: baseline, measurements: [] }),
    /refusing to overwrite Nexus session artifact/
  );
});

test('Nexus optimized validation rejects an empty artifact', async () => {
  const { root, adapter } = await fixture();
  const path = join(root, 'optimized.ady');
  await writeFile(path, '');
  await assert.rejects(() => adapter.validateOptimized(path), /optimized calibration is empty/);
});

test('Nexus optimized validation accepts a non-empty optimized.ady without pretending to parse proprietary content', async () => {
  const { root, adapter } = await fixture();
  const path = join(root, 'optimized.ady');
  await writeFile(path, '{"optimized":true}');
  const result = await adapter.validateOptimized(path);
  assert.equal(result.valid, true);
  assert.ok(result.size > 0);
  assert.match(result.validationScope, /does not reverse-engineer/i);
});
