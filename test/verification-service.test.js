import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/lib/session-store.js';
import { VerificationService } from '../src/services/verification-service.js';

async function fixture(activePreset = 2) {
  const root = await mkdtemp(join(tmpdir(), 'denon-verify-'));
  const sessions = new SessionStore(join(root, 'sessions'));
  const manifest = join(root, 'sweeps.json');
  await writeFile(manifest, JSON.stringify({ channels: {
    TFL: { shieldFile: 'TFL.wav', stimulusPath: '/tmp/TFL.wav' },
    TFR: { shieldFile: 'TFR.wav', stimulusPath: '/tmp/TFR.wav' },
    BOGUS: { shieldFile: 'BOGUS.wav', stimulusPath: '/tmp/BOGUS.wav' }
  } }));
  let measured = 0;
  const service = new VerificationService({
    denon: { async inspect() { return { presetStatus: { activeSpeakerPreset: activePreset } }; } },
    measurement: { async measureChannel() { measured += 1; throw new Error('measurement should not run when preset is wrong'); } },
    sessions
  });
  return { root, sessions, manifest, service, measured: () => measured };
}

test('Preset 1 and Preset 2 verification datasets start with identical definitions', async t => {
  const f = await fixture(1);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const started = await f.service.start({ positions: 1, channels: ['TFL'], sweepManifestPath: f.manifest, topology: ['TFL'] });
  assert.equal(started.baseline.preset, 1);
  assert.equal(started.candidate.preset, 2);
  assert.deepEqual(started.baseline.channels, started.candidate.channels);
  assert.deepEqual(started.baseline.topology, started.candidate.topology);
  assert.equal(started.baseline.sweepManifestPath, started.candidate.sweepManifestPath);
});

test('wrong active preset blocks verification before measurement audio', async t => {
  const f = await fixture(2);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const started = await f.service.start({ positions: 1, channels: ['TFL'], sweepManifestPath: f.manifest });
  const result = await f.service.advance({ sessionId: started.baselineSessionId, ready: true });
  assert.equal(result.blocked, true);
  assert.equal(result.requiresUser, true);
  assert.match(result.nextAction, /Select Speaker Preset 1/);
  assert.equal(f.measured(), 0);
});

test('standalone verification rejects an unknown explicit channel token', async t => {
  const f = await fixture(1);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(
    () => f.service.start({ positions: 1, channels: ['BOGUS'], sweepManifestPath: f.manifest }),
    /Unknown channel tokens/
  );
});

test('standalone verification rejects topology that differs from measured channels', async t => {
  const f = await fixture(1);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(
    () => f.service.start({ positions: 1, channels: ['TFL'], topology: ['TFR'], sweepManifestPath: f.manifest }),
    /topology must exactly match the channels being measured/
  );
});

test('finalization rejects mismatched verification definitions before reading acoustic records', async t => {
  const f = await fixture(1);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const started = await f.service.start({ positions: 1, channels: ['TFL'], sweepManifestPath: f.manifest });
  const baseline = await f.sessions.readJson(started.baselineSessionId, 'verification/state.json');
  const candidate = await f.sessions.readJson(started.candidateSessionId, 'verification/state.json');
  baseline.status = 'complete';
  candidate.status = 'complete';
  candidate.channels = ['TFR'];
  await f.sessions.writeJson(started.baselineSessionId, 'verification/state.json', baseline, { overwrite: true });
  await f.sessions.writeJson(started.candidateSessionId, 'verification/state.json', candidate, { overwrite: true });
  const result = await f.service.finalize({ baselineSessionId: started.baselineSessionId, candidateSessionId: started.candidateSessionId });
  assert.equal(result.finalized, false);
  assert.equal(result.blocked, true);
  assert.match(result.reason, /definitions do not match/);
});
