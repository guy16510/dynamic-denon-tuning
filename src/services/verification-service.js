import { readFile, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeMeasuredComparison } from '../calibration/verification.js';
import { renderVerificationReport } from '../calibration/report.js';

async function loadManifest(path) {
  const resolved = resolve(path);
  await access(resolved, constants.R_OK);
  const parsed = JSON.parse(await readFile(resolved, 'utf8'));
  if (!parsed.channels || typeof parsed.channels !== 'object') throw new Error('sweep manifest must contain channels');
  return { ...parsed, path: resolved };
}

function micInstruction(position) {
  if (position === 0) return 'Place the microphone at the exact primary listening position.';
  return `Move the microphone to verification position ${position}, matching the baseline position exactly.`;
}

function datasetDefinition(state) {
  return {
    positions: state.positions,
    channels: state.channels,
    topology: state.topology,
    sweepManifestPath: state.sweepManifestPath
  };
}

function sameDatasetDefinition(left, right) {
  return JSON.stringify(datasetDefinition(left)) === JSON.stringify(datasetDefinition(right));
}

export class VerificationService {
  constructor({ denon, measurement, sessions }) {
    this.denon = denon;
    this.measurement = measurement;
    this.sessions = sessions;
  }

  async createDataset({ preset, positions, channels, sweepManifestPath, topology }) {
    const session = await this.sessions.create({
      purpose: 'post-calibration-verification',
      receiver: 'Denon AVR-X3700H',
      preset,
      positions,
      channels,
      topology,
      sweepManifestPath
    });
    const state = {
      schemaVersion: 1,
      sessionId: session.id,
      preset,
      status: 'awaiting_preset',
      positions,
      channels,
      topology,
      sweepManifestPath,
      currentPosition: 0,
      currentChannelIndex: 0,
      completed: [],
      rejectedAttempts: [],
      nextAction: `Select Speaker Preset ${preset}, then resume.`
    };
    await this.sessions.writeJson(session.id, 'verification/state.json', state);
    return { session, state };
  }

  async start({ positions, channels, sweepManifestPath, topology = null }) {
    if (!Number.isInteger(positions) || positions < 1 || positions > 7) throw new Error('positions must be 1-7');
    if (!Array.isArray(channels) || !channels.length) throw new Error('channels are required');
    const manifest = await loadManifest(sweepManifestPath);
    for (const channel of channels) {
      if (!manifest.channels[channel]?.shieldFile || !manifest.channels[channel]?.stimulusPath) {
        throw new Error(`sweep manifest missing shieldFile/stimulusPath for ${channel}`);
      }
    }
    const definition = { positions, channels: [...channels], sweepManifestPath: manifest.path, topology: topology ? [...topology] : [...channels] };
    const baseline = await this.createDataset({ preset: 1, ...definition });
    const candidate = await this.createDataset({ preset: 2, ...definition });
    return {
      baselineSessionId: baseline.session.id,
      candidateSessionId: candidate.session.id,
      status: 'awaiting_preset_1',
      nextAction: 'Select Speaker Preset 1, then resume.',
      baseline: baseline.state,
      candidate: candidate.state
    };
  }

  async status(sessionId) {
    return this.sessions.readJson(sessionId, 'verification/state.json');
  }

  async save(state, event, data = {}) {
    state.updatedAt = new Date().toISOString();
    await this.sessions.writeJson(state.sessionId, 'verification/state.json', state, { overwrite: true });
    await this.sessions.appendEvent(state.sessionId, event, data);
  }

  async verifyPreset(state) {
    const inspected = await this.denon.inspect();
    const active = inspected?.presetStatus?.activeSpeakerPreset ?? null;
    if (active !== state.preset) {
      state.status = 'awaiting_preset';
      state.nextAction = `Select Speaker Preset ${state.preset}, then resume.`;
      await this.save(state, 'verification.wrong-preset', { expected: state.preset, active });
      return { ok: false, active, nextAction: state.nextAction };
    }
    return { ok: true, active };
  }

  async advance({ sessionId, ready = false } = {}) {
    const state = await this.status(sessionId);
    const preset = await this.verifyPreset(state);
    if (!preset.ok) return { state, blocked: true, requiresUser: true, ...preset };
    if (!ready && state.status !== 'measuring') {
      state.status = 'awaiting_position';
      state.nextAction = micInstruction(state.currentPosition);
      await this.save(state, 'verification.preset-confirmed', { preset: state.preset });
      return { state, requiresUser: true, instruction: state.nextAction };
    }

    const manifest = await loadManifest(state.sweepManifestPath);
    state.status = 'measuring';
    for (let i = state.currentChannelIndex; i < state.channels.length; i += 1) {
      const channel = state.channels[i];
      const spec = manifest.channels[channel];
      const measured = await this.measurement.measureChannel({
        sessionId,
        position: state.currentPosition,
        channel,
        shieldFile: spec.shieldFile,
        stimulusPath: spec.stimulusPath,
        title: `VERIFY-P${state.preset}-${channel}-${state.currentPosition}`,
        notes: `preset=${state.preset} verification position=${state.currentPosition} channel=${channel}`,
        verifyAtmos: true,
        expectedPreset: state.preset,
        measurementType: 'post-calibration-verification'
      });
      if (measured.wrongPreset) return { state, blocked: true, requiresUser: true, nextAction: measured.next };
      if (measured.manualRequired) {
        state.status = 'manual_measurement_required';
        state.currentChannelIndex = i;
        state.pendingMeasurement = {
          position: state.currentPosition,
          channel,
          beforeMeasurementKeys: measured.beforeMeasurementKeys,
          shieldFile: spec.shieldFile
        };
        await this.save(state, 'verification.manual-required', state.pendingMeasurement);
        return { state, measurement: measured, requiresUser: true };
      }
      if (!measured.record.acceptedForOptimization) {
        state.rejectedAttempts.push({ position: state.currentPosition, channel, rewId: measured.record.rewId, attempt: measured.record.attempt, path: measured.path });
        state.status = 'retry_required';
        state.currentChannelIndex = i;
        state.nextAction = `Measurement failed evidence gate for ${channel}. Correct the cause and resume to retry without deleting attempt ${measured.record.attempt}.`;
        await this.save(state, 'verification.measurement-rejected', state.rejectedAttempts.at(-1));
        return { state, retryRequired: true, measurement: measured };
      }
      state.completed.push({ position: state.currentPosition, channel, rewId: measured.record.rewId, attempt: measured.record.attempt, path: measured.path });
      state.currentChannelIndex = i + 1;
      await this.save(state, 'verification.measurement-accepted', state.completed.at(-1));
    }

    state.currentPosition += 1;
    state.currentChannelIndex = 0;
    if (state.currentPosition < state.positions) {
      state.status = 'awaiting_position';
      state.nextAction = micInstruction(state.currentPosition);
      await this.save(state, 'verification.position-complete', { position: state.currentPosition - 1 });
      return { state, requiresUser: true, instruction: state.nextAction };
    }
    state.status = 'complete';
    state.nextAction = state.preset === 1
      ? 'Baseline verification complete. Select Speaker Preset 2, then resume the candidate verification dataset.'
      : 'Candidate verification complete. Final measured comparison may now run.';
    await this.save(state, 'verification.dataset-complete', { preset: state.preset, measurements: state.completed.length });
    return { state, completed: true, nextAction: state.nextAction };
  }

  async resumeManual({ sessionId }) {
    const state = await this.status(sessionId);
    if (state.status !== 'manual_measurement_required' || !state.pendingMeasurement) throw new Error('verification dataset has no pending manual measurement');
    const preset = await this.verifyPreset(state);
    if (!preset.ok) return { state, blocked: true, requiresUser: true, ...preset };
    const pending = state.pendingMeasurement;
    const measured = await this.measurement.captureManual({
      sessionId,
      position: pending.position,
      channel: pending.channel,
      beforeMeasurementKeys: pending.beforeMeasurementKeys,
      shieldFile: pending.shieldFile,
      verifyAtmos: true,
      expectedPreset: state.preset,
      measurementType: 'post-calibration-verification'
    });
    if (!measured.record?.acceptedForOptimization) {
      if (measured.record) state.rejectedAttempts.push({ position: pending.position, channel: pending.channel, rewId: measured.record.rewId, attempt: measured.record.attempt, path: measured.path });
      state.status = 'retry_required';
      delete state.pendingMeasurement;
      state.nextAction = `Manual measurement failed for ${pending.channel}. Fix the cause and retry; existing evidence remains immutable.`;
      await this.save(state, 'verification.manual-rejected', state.rejectedAttempts.at(-1) || pending);
      return { state, measured, retryRequired: true };
    }
    state.completed.push({ position: pending.position, channel: pending.channel, rewId: measured.record.rewId, attempt: measured.record.attempt, path: measured.path });
    state.currentChannelIndex += 1;
    delete state.pendingMeasurement;
    state.status = 'measuring';
    await this.save(state, 'verification.manual-accepted', state.completed.at(-1));
    return this.advance({ sessionId, ready: true });
  }

  async finalize({ baselineSessionId, candidateSessionId, minimumGain = 0.5, majorRegression = 8, reportSessionId = candidateSessionId }) {
    const [baselineState, candidateState] = await Promise.all([this.status(baselineSessionId), this.status(candidateSessionId)]);
    if (baselineState.status !== 'complete' || candidateState.status !== 'complete') {
      return { finalized: false, blocked: true, reason: 'Both preset verification datasets must be complete.', baselineState, candidateState };
    }
    if (!sameDatasetDefinition(baselineState, candidateState)) {
      return {
        finalized: false,
        blocked: true,
        reason: 'Preset verification dataset definitions do not match. Comparison is prohibited.',
        baselineDefinition: datasetDefinition(baselineState),
        candidateDefinition: datasetDefinition(candidateState)
      };
    }
    if (baselineState.preset !== 1 || candidateState.preset !== 2) {
      return { finalized: false, blocked: true, reason: 'Verification preset identities are invalid.', baselinePreset: baselineState.preset, candidatePreset: candidateState.preset };
    }
    const [baselineRecords, candidateRecords] = await Promise.all([
      this.sessions.readMeasurementRecords(baselineSessionId, { acceptedOnly: true }),
      this.sessions.readMeasurementRecords(candidateSessionId, { acceptedOnly: true })
    ]);
    for (const record of baselineRecords) record.preset = 1;
    for (const record of candidateRecords) record.preset = 2;
    const result = finalizeMeasuredComparison(baselineRecords, candidateRecords, { minimumGain, majorRegression });
    const report = renderVerificationReport({
      receiver: 'Denon AVR-X3700H',
      baselineSessionId,
      candidateSessionId,
      baselineState,
      candidateState,
      result
    });
    const verificationPath = await this.sessions.writeJson(reportSessionId, 'optimized/final-verification.json', {
      schemaVersion: 1,
      verifiedAt: new Date().toISOString(),
      baselineSessionId,
      candidateSessionId,
      datasetDefinition: datasetDefinition(baselineState),
      ...result
    });
    const reportPath = this.sessions.path(reportSessionId, 'report.md');
    await writeFile(reportPath, report, { encoding: 'utf8', flag: 'wx' });
    return { finalized: true, verificationPath, reportPath, ...result };
  }
}
