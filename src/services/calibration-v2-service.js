import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAdyText, createAdyCandidate } from '../adapters/audyssey-ady.js';
import { measurementsFromAudyssey } from '../measurement/audyssey-measurement-source.js';
import { exportRewImpulse } from '../measurement/rew-impulse-export.js';
import { loadAndLockTargetProfile } from '../calibration/target-profile.js';
import { buildV2Report } from '../calibration/report-v2.js';
import { HardwareCalibrationLock } from './hardware-calibration-lock.js';

async function writeExclusive(path, content) {
  await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  return path;
}

function safeCandidateId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error('candidateId must be 1-80 safe filename characters');
  return id;
}

export class CalibrationV2Service {
  constructor({ config, sessions, events, stateMachine, theater, denon, shield }) {
    this.config = config; this.sessions = sessions; this.events = events; this.stateMachine = stateMachine;
    this.theater = theater; this.denon = denon; this.shield = shield;
    this.lock = new HardwareCalibrationLock(sessions.rootDir);
  }

  async profiles() {
    const locked = await loadAndLockTargetProfile(this.config.calibration.profilePath);
    return [{ name: locked.snapshot.name, version: locked.snapshot.version, hash: locked.sha256, path: this.config.calibration.profilePath }];
  }

  async create({ profilePath = this.config.calibration.profilePath, sourceAdy = null } = {}) {
    const profile = await loadAndLockTargetProfile(resolve(profilePath));
    const session = await this.sessions.create({ purpose: 'deterministic-v2-calibration', receiver: 'Denon AVR-X3700H', protectedPreset: 1, candidatePreset: 2, targetProfileHash: profile.sha256 });
    for (const directory of ['receiver', 'audyssey/source', 'audyssey/extracted', 'audyssey/candidates', 'candidates', 'champion', 'reports']) await mkdir(this.sessions.path(session.id, directory), { recursive: true });
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
    let inspection;
    try {
      inspection = await this.theater.inspect();
    } catch (error) {
      await this.stateMachine.transition(sessionId, 'BLOCKED', { reason: 'read-only theater preflight failed', error: error.message });
      await this.events.append(sessionId, 'operator.action-required', { action: 'Resolve receiver/REW/Shield connectivity reported by read-only preflight, then retry.', error: error.message });
      await this.lock.release(sessionId);
      return this.status(sessionId);
    }
    await this.sessions.writeJson(sessionId, 'receiver/preflight.json', inspection, { overwrite: true });
    await this.events.append(sessionId, 'preflight.completed', { receiverWritesEnabled: this.config.denon.allowWrites, activePreset: inspection.denon?.presetStatus?.activeSpeakerPreset ?? null, nativeMeasurementCapability: (await this.measurementCapability(sessionId)).state });
    let metadata;
    try { metadata = await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!metadata) {
      await this.stateMachine.transition(sessionId, 'BLOCKED', { reason: 'Audyssey source measurement required' });
      await this.events.append(sessionId, 'operator.action-required', { action: 'Run a normal MultEQ calibration with ACM1HB connected to the Denon, export the .ady, then import it. No receiver write has been attempted.' });
      await this.lock.release(sessionId);
      return this.status(sessionId);
    }
    await this.stateMachine.transition(sessionId, 'BASELINE_READY', { source: 'audyssey-ady', postCorrection: false });
    await this.events.append(sessionId, 'operator.action-required', { action: 'Baseline Audyssey evidence is ready. Native post-correction measurement remains disabled until X3700H H5 proves the active correction is visible in captured evidence.' });
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

  async restoreBaseline({ sessionId, reason = 'operator restore' } = {}) {
    if (!this.config.denon.allowWrites) return { restored: false, blocked: true, sessionId, reason: 'ALLOW_RECEIVER_WRITES is disabled.' };
    try {
      await this.denon.selectPreset(1);
      await this.events.append(sessionId, 'baseline.restored', { preset: 1, reason });
      return { restored: true, sessionId, preset: 1 };
    } catch (error) {
      await this.events.append(sessionId, 'baseline.restore-blocked', { reason, error: error.message });
      return { restored: false, blocked: true, sessionId, reason: error.message };
    }
  }

  async abort({ sessionId }) {
    const current = await this.stateMachine.state(sessionId);
    await this.shield?.stop?.().catch(() => {});
    const restoration = await this.restoreBaseline({ sessionId, reason: 'session abort' });
    if (!['COMPLETE', 'ABORTED', 'FAILED'].includes(current)) {
      await this.stateMachine.transition(sessionId, 'ABORTED', { reason: 'operator abort' });
      await this.events.append(sessionId, 'session.aborted', { previousState: current, restoration });
    }
    await this.lock.release(sessionId);
    return { ...(await this.status(sessionId)), restoration };
  }

  async createCandidateAdy({ sessionId, candidateId, changes }) {
    const id = safeCandidateId(candidateId);
    const original = await readFile(this.sessions.path(sessionId, 'audyssey/source/original.ady'), 'utf8');
    const parsed = parseAdyText(original, { sourceFilename: this.sessions.path(sessionId, 'audyssey/source/original.ady') });
    const candidate = createAdyCandidate(parsed, changes, { candidateId: id });
    await writeExclusive(this.sessions.path(sessionId, `audyssey/candidates/${id}.ady`), candidate.text);
    await this.sessions.writeJson(sessionId, `audyssey/candidates/${id}.json`, { candidateId: id, sha256: candidate.sha256, diffs: candidate.diffs, sourceSha256: parsed.metadata.sourceSha256 });
    await this.events.append(sessionId, 'candidate.generated', { candidateId: id, sha256: candidate.sha256, diffs: candidate.diffs });
    return { candidateId: id, sha256: candidate.sha256, diffs: candidate.diffs };
  }

  async applyBest({ sessionId }) {
    let champion;
    try { champion = await this.sessions.readJson(sessionId, 'champion/champion.json'); } catch (error) { if (error.code === 'ENOENT') return { applied: false, blocked: true, reason: 'No champion has been established.' }; throw error; }
    if (champion?.verification?.postCorrection !== true) return { applied: false, blocked: true, reason: 'Champion does not have physical post-correction verification evidence.' };
    if (!this.config.denon.allowWrites) return { applied: false, blocked: true, reason: 'ALLOW_RECEIVER_WRITES is disabled.' };
    await this.denon.selectPreset(2);
    return { applied: true, preset: 2, championId: champion.candidateId };
  }

  async measurementCapability(sessionId) {
    if (this.config.calibration.nativeMeasurement === 'off') return { state: 'unsupported', postCorrection: false, hardwareVerification: 'software-tested', reason: 'disabled by configuration' };
    try { return await this.sessions.readJson(sessionId, 'receiver/capabilities.json'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { state: 'unknown', postCorrection: false, hardwareVerification: 'hardware-unverified', reason: 'H4/H5 hardware evidence has not been recorded' }; }
  }

  async status(sessionId) {
    const [session, state, events, measurementCapability] = await Promise.all([this.sessions.readJson(sessionId, 'session.json'), this.stateMachine.state(sessionId), this.events.read(sessionId), this.measurementCapability(sessionId)]);
    let profile = null, audyssey = null, champion = null;
    try { profile = await this.sessions.readJson(sessionId, 'target-profile.json'); } catch {}
    try { audyssey = await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json'); } catch {}
    try { champion = await this.sessions.readJson(sessionId, 'champion/champion.json'); } catch {}
    return { ...session, state, targetProfile: profile, audyssey, champion, eventCount: events.length, measurementCapability: { ...measurementCapability, nativeState: measurementCapability.state }, productMode: 'guided-automatic-calibration' };
  }

  async exportReport(sessionId) {
    const status = await this.status(sessionId);
    const events = await this.events.read(sessionId);
    const report = buildV2Report({ session: status, events, measurementCapability: status.measurementCapability, targetProfile: status.targetProfile, audyssey: status.audyssey, champion: status.champion, software: { application: 'dynamic-denon-tuning', version: '0.5.0' } });
    await this.sessions.writeJson(sessionId, 'reports/final.json', report.json, { overwrite: true });
    await writeFile(this.sessions.path(sessionId, 'reports/final.md'), report.markdown, 'utf8');
    return { sessionId, jsonPath: this.sessions.path(sessionId, 'reports/final.json'), markdownPath: this.sessions.path(sessionId, 'reports/final.md'), report: report.json };
  }

  async listSessions() {
    const entries = await readdir(this.sessions.rootDir, { withFileTypes: true }).catch(() => []);
    const output = [];
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) { try { output.push(await this.status(entry.name)); } catch {} }
    return output;
  }
  async eventsFor(sessionId) { return this.events.read(sessionId); }
  async measurementsFor(sessionId) { try { return (await this.sessions.readJson(sessionId, 'audyssey/source/metadata.json')).exports || []; } catch { return []; } }
  async candidatesFor(sessionId) {
    const entries = await readdir(this.sessions.path(sessionId, 'audyssey/candidates'), { withFileTypes: true }).catch(() => []);
    const output = [];
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) output.push(await this.sessions.readJson(sessionId, `audyssey/candidates/${entry.name}`));
    return output;
  }
}
