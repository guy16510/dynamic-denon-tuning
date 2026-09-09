import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TheaterService } from '../src/services/theater-service.js';

function baseConfig() {
  return {
    denon: { allowWrites: false },
    rew: { measurementMode: 'pro' }
  };
}

function serviceFixture({ workflow, root, rew, nexus }) {
  let current = structuredClone(workflow);
  const events = [];
  const sessions = {
    path(sessionId, relativePath) { return join(root, relativePath); },
    async readJson() { return structuredClone(current); },
    async writeJson(sessionId, path, value) {
      if (path === 'workflow.json') current = structuredClone(value);
      return join(root, path);
    },
    async appendEvent(sessionId, type, data) { events.push({ type, data }); }
  };
  const service = new TheaterService({
    config: baseConfig(),
    evoburrow: {},
    denon: {},
    rew,
    shield: {},
    nexus,
    measurement: {},
    sessions
  });
  return { service, getWorkflow: () => current, events };
}

test('Nexus cannot start when verified REW archive is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theater-'));
  const baselineAdy = join(root, 'baseline.ady');
  await writeFile(baselineAdy, 'baseline');
  let nexusPrepared = false;
  const f = serviceFixture({
    root,
    workflow: { sessionId: 's', status: 'measurements_complete', baselineAdy, rewMdat: null, completedMeasurements: [], blockers: [] },
    rew: {},
    nexus: { async prepare() { nexusPrepared = true; } }
  });
  const result = await f.service.advance({ sessionId: 's' });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /verified REW \.mdat archive missing/);
  assert.equal(nexusPrepared, false);
});

test('configured Nexus command completion remains resumable and awaits explicit optimized artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theater-'));
  const baselineAdy = join(root, 'baseline.ady');
  const mdat = join(root, 'theater.mdat');
  await writeFile(baselineAdy, 'baseline');
  await writeFile(mdat, 'raw rew archive');
  const f = serviceFixture({
    root,
    workflow: { sessionId: 's', status: 'measurements_complete', baselineAdy, rewMdat: mdat, completedMeasurements: [{ channel: 'TFL' }], blockers: [] },
    rew: {},
    nexus: {
      async prepare() { return { manifestPath: join(root, 'handoff.json') }; },
      async optimize() { return { automated: true, interactiveRequired: false, stdout: 'done' }; }
    }
  });
  const result = await f.service.advance({ sessionId: 's' });
  assert.equal(result.workflow.status, 'awaiting_nexus');
  assert.equal(result.requiresUser, true);
  assert.match(result.instruction, /Provide its generated optimized\.ady path/);
  assert.ok(f.events.some(event => event.type === 'nexus.prepared' && event.data.automatedCommandCompleted === true));
});

test('failed REW archive creation blocks Nexus and is retried on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theater-'));
  await mkdir(join(root, 'rew'), { recursive: true });
  let saves = 0;
  const rew = {
    async saveAll(path) {
      saves += 1;
      if (saves === 1) throw new Error('REW command accepted but file never appeared');
      await writeFile(path, 'verified archive');
      return { saved: true, verified: true, path, size: 16 };
    }
  };
  const f = serviceFixture({
    root,
    workflow: { sessionId: 's', status: 'measurement_archive_failed', completedMeasurements: [{ channel: 'TFL' }], blockers: ['REW MDAT archive failed: prior failure'] },
    rew,
    nexus: {}
  });
  const first = await f.service.advance({ sessionId: 's' });
  assert.equal(first.blocked, true);
  assert.equal(f.getWorkflow().status, 'measurement_archive_failed');
  const second = await f.service.advance({ sessionId: 's' });
  assert.notEqual(f.getWorkflow().status, 'measurement_archive_failed');
  assert.equal(f.getWorkflow().rewMdat, join(root, 'rew/theater.mdat'));
  assert.equal(saves, 2);
});
