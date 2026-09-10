import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAdyText, createAdyCandidate } from '../adapters/audyssey-ady.js';
import { measurementsFromAudyssey } from '../measurement/audyssey-measurement-source.js';
import { exportRewImpulse } from '../measurement/rew-impulse-export.js';
import { loadAndLockTargetProfile } from '../calibration/target-profile.js';
import { HardwareCalibrationLock } from './hardware-calibration-lock.js';

async function writeExclusive(path, content) {
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  return path;
}

export class CalibrationV2Service {
  constructor({ config, sessions, events, stateMachine, theater, denon, shield }) {
    this.config = config;
    this.sessions = sessions;
    this.events = events;
    this.stateMachine = stateMachine;
    this.theater = theater;
    this.denon = denon;
    this.shield = shield;
    this.lock = new HardwareCalibrationLock(sessions.rootDir);
  }

  async profiles() {
    const locked = await loadAndLockTargetProfile(this.config.calibration.profilePath);
    return [{ name: locked.snapshot.name, version: locked.snapshot.version, hash: locked.sha256, path: this.config.calibration.profilePath }];
  }

  async create({ profilePath = this.config.calibration.profilePath, sourceAdy = null } = {}) {
    const profile = await loadAndLockTargetProfile(resolve(profilePath));
    const session = await this.sessions.create({
      purpose: 'deterministic-v2-calibration',
      receiver: 'Denon AVR-X3700H',
      protectedPreset: 1,
      candidatePreset: 2,
      targetProfileHash: profile.sha256
    });
    for (const directory of ['receiver', 'audyssey/source', 'audyssey/extracted', 'audyssey/candidates', 'candidates', 'champion', 'reports']) {
      await mkdir(this.sessions.path(session.id, directory), { recursive: true });
    }
    await this.sessions.writeJson(session.id, 'target-profile.json', { ...profile.snapshot, sha256: profile.sha256 });
    await this.events.append(session.id, 'session.created', { targetProfileHash: profile.sha256, mode: 'guided-automatic-calibration' });
    if (sourceAdy) await this.importAudyssey({ sessionId: session.id, path: sourceAdy });
    return this.status(session.id);
  }

  async importAudyssey({ sessionId, path }) {
    const sourcePath = resolve(path);
    const text = await readFile(sourcePath, 'utf8');
    const parsed = parseAdyText(text, { sourceFilename: sourcePath });
    const originalPath = this.sessions.path(sessionId, 'audyssey/source/original.ady');
    await writeExclusive(originalPath, text);
    const measurements = measurementsFromAudyssey(parsed, { sessionId });
    const exports = [];
    for (const measurement of measurements) {
      const exported = exportRewImpulse({ samples: measurement.impulseResponse, sampleRateHz: measurement.sampleRateHz, channel: measurement.channel, position: measurement.position });
      const destination = this.sessions.path(sessionId, `audyssey/extracted/${exported.filename}`);
      await writeExclusive(destination, exported.text);
      exports.push({ channel: measurement.channel, position: measurement.position, filename: exported.filename, path: destination, measurementId: measurement.id });
    }
    await this.sessions.writeJson(sessionId, 'audyssey/source/metadata.json', { ...parsed.metadata, channels: parsed.channels.map(channel => ({ id: channel.id, positions: channel.responses.map(response => response.position), responseLengths: channel.responseLengths })), exports });
    await this.events.append(sessionId, 'measurement.completed', { source: 'audyssey-ady', sourceSha256: parsed.metadata.sourceSha256, measurements: measurements.length, postCorrection: false });
    return { metadata: parsed.metadata, measurements: measurements.length, exports };
  }

  async start({ sessionId }) {
    const current = await this.stateMachine.state(sessionId);
    if (current === 'BLOCKED') await this.stateMachine.transition(sessionId, 'PREFLIGHT', { reason: 'operator retry' });
    else if (current === 'CREATED') await this.stateMachine.transition(sessionId, 'PREFLIGHT');
    else throw new Error(`calibration start requires CREATED or BLOCKED state, received ${current}`);

    const lock = await this.lock.acquire(sessionId);
    if (!lock.acquired) {
      await this.stateMachine.transition(sessionId, 'BLOCKED', { reason: 'another hardware-mutating session owns the lock', owner: lock.owner || null });
      return this.status(sessionId);
    }

    await this.events.append(sessionId, 'preflight.started', {});
    const inspection = await this.theater.inspect();
    await this.sessions.writeJson(sessionId, 'receiver/preflight.json', inspection, { overwrite: true });
    await this.events.append(sessionId, 'preflight.completed', {
      receiverWritesEnabled: this.config.denon.allowWrites,
      activePreset: inspection.denon?.presetStatus?.activeSpeakerPreset ?? null,
      nativeMeasurementCapability: 'unknown'
    });

    let metadata;
    try { metadata = await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!metadata) {
      await this.stateMachine.transition(sessionId, 'BLOCKED', { reason: 'Audyssey source measurement required' });
      await this.events.append(sessionId, 'operator.action-required', { action: 'Run a normal MultEQ calibration with ACM1HB connected to the Denon, export the .ady, then import it. No receiver write has been attempted.' });
      await this.lock.release(sessionId);
      return this.status(sessionId);
    }

    await this.stateMachine.transition(sessionId, 'BASELINE_READY', { source: 'audyssey-ady', postCorrection: false });
    await this.events.append(sessionId, 'operator.action-required', {
      action: 'Baseline Audyssey evidence is ready. Native post-correction measurement remains disabled until X3700H H5 proves the active correction is visible in captured evidence.'
    });
    return this.status(sessionId);
  }

  async pause({ sessionId }) {
    const current = await this.stateMachine.state(sessionId);
    if (['COMPLETE', 'ABORTED', 'FAILED', 'PAUSED'].includes(current)) return this.status(sessionId);
    await this.shield?.stop?.().catch(() => {});
    await this.stateMachine.transition(sessionId, 'PAUSED', { resumeState: current });
    await this.events.append(sessionId, 'session.paused', { resumeState: current });
    return this.status(sessionId);
  }

  async resume({ sessionId }) {
    const current = await this.stateMachine.state(sessionId);
    if (current === 'BLOCKED') return this.start({ sessionId });
    if (current !== 'PAUSED') throw new Error(`calibration resume requires PAUSED or BLOCKED state, received ${current}`);
    const history = await this.events.read(sessionId);
    const pause = history.filter(event => event.type === 'session.paused').at(-1);
    const resumeState = pause?.data?.resumeState || 'PREFLIGHT';
    const lock = await this.lock.acquire(sessionId);
    if (!lock.acquired) throw new Error('cannot resume while another hardware-mutating calibration owns the lock');
    await this.stateMachine.transition(sessionId, resumeState, { reason: 'operator resume' });
    await this.events.append(sessionId, 'session.resumed', { state: resumeState });
    return this.status(sessionId);
  }

  async abort({ sessionId }) {
    const current = await this.stateMachine.state(sessionId);
    if (!['COMPLETE', 'ABORTED', 'FAILED'].includes(current)) {
      await this.shield?.stop?.().catch(() => {});
      await this.stateMachine.transition(sessionId, 'ABORTED', { reason: 'operator abort' });
      await this.events.append(sessionId, 'session.aborted', { previousState: current });
    }
    await this.lock.release(sessionId);
    return this.status(sessionId);
  }

  async createCandidateAdy({ sessionId, candidateId, changes }) {
    const original = await readFile(this.sessions.path(sessionId, 'audyssey/source/original.ady'), 'utf8');
    const parsed = parseAdyText(original, { sourceFilename: this.sessions.path(sessionId, 'audyssey/source/original.ady') });
    const candidate = createAdyCandidate(parsed, changes, { candidateId });
    await writeExclusive(this.sessions.path(sessionId, `audyssey/candidates/${candidateId}.ady`), candidate.text);
    await this.sessions.writeJson(sessionId, `audyssey/candidates/${candidateId}.json`, { candidateId, sha256: candidate.sha256, diffs: candidate.diffs, sourceSha256: parsed.metadata.sourceSha256 });
    await this.events.append(sessionId, 'candidate.generated', { candidateId, sha256: candidate.sha256, diffs: candidate.diffs });
    return { candidateId, sha256: candidate.sha256, diffs: candidate.diffs };
  }

  async applyBest({ sessionId }) {
    let champion;
    try { champion = await this.sessions.readJson(sessionId, 'champion/champion.json'); } catch (error) { if (error.code === 'ENOENT') return { applied: false, blocked: true, reason: 'No champion has been established.' }; throw error; }
    if (champion?.verification?.postCorrection !== true) return { applied: false, blocked: true, reason: 'Champion does not have physical post-correction verification evidence.' };
    if (!this.config.denon.allowWrites) return { applied: false, blocked: true, reason: 'ALLOW_RECEIVER_WRITES is disabled.' };
    await this.denon.selectPreset(2);
    return { applied: true, preset: 2, championId: champion.candidateId };
  }

  async status(sessionId) {
    const [session, state, events] = await Promise.all([
      this.sessions.readJson(sessionId, 'session.json'),
      this.stateMachine.state(sessionId),
      this.events.read(sessionId)
    ]);
    let profile = null, audyssey = null, champion = null;
    try { profile = await this.sessions.readJson(sessionId, 'target-profile.json'); } catch {}
    try { audyssey = await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json'); } catch {}
    try { champion = await this.sessions.readJson(sessionId, 'champion/champion.json'); } catch {}
    return {
      ...session,
      state,
      targetProfile: profile,
      audyssey,
      champion,
      eventCount: events.length,
      measurementCapability: {
        nativeState: this.config.calibration.nativeMeasurement === 'off' ? 'unsupported' : 'unknown',
        postCorrection: false,
        hardwareVerification: 'hardware-unverified'
      },
      productMode: 'guided-automatic-calibration'
    };
  }

  async listSessions() {
    const entries = await readdir(this.sessions.rootDir, { withFileTypes: true }).catch(() => []);
    const output = [];
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      try { output.push(await this.status(entry.name)); } catch {}
    }
    return output;
  }

  async eventsFor(sessionId) { return this.events.read(sessionId); }
  async measurementsFor(sessionId) {
    let metadata;
    try { metadata = await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json'); } catch { return []; }
    return metadata.exports || [];
  }
  async candidatesFor(sessionId) {
    const entries = await readdir(this.sessions.path(sessionId, 'audyssey/candidates'), { withFileTypes: true }).catch(() => []);
    const output = [];
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) output.push(await this.sessions.readJson(sessionId, `audyssey/candidates/${entry.name}`));
    return output;
  }
}
