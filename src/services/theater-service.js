import { readFile, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { scoreCalibration } from '../calibration/score.js';
import { compareScores } from '../calibration/compare.js';
import { renderCalibrationReport } from '../calibration/report.js';

const DEFAULT_CHANNELS = ['FL', 'FR', 'C', 'SL', 'SR', 'SBL', 'SBR', 'TFL', 'TFR', 'TRL', 'TRR', 'SW1'];

function nextMicInstruction(position) {
  const labels = [
    'Place the microphone at the exact primary listening position.',
    'Move the microphone 10 cm left of the primary position.',
    'Move the microphone 10 cm right of the primary position.',
    'Move the microphone 10 cm forward of the primary position.',
    'Move the microphone 10 cm backward of the primary position.',
    'Move the microphone slightly above the primary position.',
    'Move the microphone slightly below the primary position.'
  ];
  return labels[position] || `Move the microphone to position ${position}.`;
}

async function loadManifest(path) {
  if (!path) return null;
  const resolved = resolve(path);
  await access(resolved, constants.R_OK);
  const parsed = JSON.parse(await readFile(resolved, 'utf8'));
  if (!parsed.channels || typeof parsed.channels !== 'object') throw new Error('sweep manifest must contain a channels object');
  return { ...parsed, path: resolved };
}

export class TheaterService {
  constructor({ config, evoburrow, denon, rew, shield, nexus, measurement, sessions }) {
    this.config = config;
    this.evoburrow = evoburrow;
    this.denon = denon;
    this.rew = rew;
    this.shield = shield;
    this.nexus = nexus;
    this.measurement = measurement;
    this.sessions = sessions;
  }

  async inspect() {
    const [evoburrow, denon, measurement] = await Promise.all([
      this.evoburrow.status(),
      this.denon.inspect(),
      this.measurement.preflight()
    ]);
    return {
      receiver: 'Denon AVR-X3700H',
      evoburrow,
      denon,
      measurement,
      safety: {
        receiverWritesEnabled: this.config.denon.allowWrites,
        protectedPreset: 1,
        optimizedPreset: 2,
        rawDenonWritesExposed: false
      }
    };
  }

  async snapshot(sessionId = null) {
    const snapshot = await this.denon.snapshot();
    if (!sessionId) return snapshot;
    const path = await this.sessions.writeJson(sessionId, 'baseline/avr.json', snapshot);
    return { snapshot, path };
  }

  async startAutotune({ positions = 3, channels = DEFAULT_CHANNELS, baselineAdy = null, sweepManifestPath = null } = {}) {
    if (!Number.isInteger(positions) || positions < 1 || positions > 7) throw new Error('positions must be an integer from 1 to 7');
    const manifest = await loadManifest(sweepManifestPath);
    const session = await this.sessions.create({
      purpose: 'full-theater-autotune',
      receiver: 'Denon AVR-X3700H',
      targetPreset: 2,
      protectedPreset: 1,
      positions,
      channels
    });

    const inspect = await this.inspect();
    await this.sessions.writeJson(session.id, 'baseline/preflight.json', inspect);
    const baseline = await this.snapshot(session.id);
    let baselineCopy = null;
    if (baselineAdy) baselineCopy = await this.sessions.copyArtifact(session.id, resolve(baselineAdy), 'baseline/calibration.ady');

    const activePreset = inspect.denon?.presetStatus?.activeSpeakerPreset ?? null;
    const workflow = {
      schemaVersion: 1,
      sessionId: session.id,
      status: 'awaiting_position',
      phase: 'baseline_complete',
      positions,
      channels,
      currentPosition: 0,
      currentChannelIndex: 0,
      completedMeasurements: [],
      baselineAdy: baselineCopy,
      sweepManifestPath: manifest?.path || null,
      activePresetAtStart: activePreset,
      protectedPreset: 1,
      optimizedPreset: 2,
      blockers: [],
      nextAction: nextMicInstruction(0)
    };

    if (activePreset === 2) {
      workflow.blockers.push('Speaker Preset 2 is currently active. Preset 1 remains protected, but establish which preset contains the true baseline before writing any optimized calibration.');
    }
    if (!baselineCopy) workflow.blockers.push('No baseline .ady was supplied. XT32 optimization cannot start until a MultEQ Editor calibration is exported.');
    if (!manifest) workflow.blockers.push('No sweep manifest was supplied. Automatic per-channel Shield playback cannot start until one is configured.');
    if (inspect.measurement?.autoMeasure?.automated !== true && this.config.rew.measurementMode !== 'pro') {
      workflow.blockers.push('Automated REW measurement start is not confirmed. REW Pro is required for fully automatic API-triggered sweeps.');
    }

    await this.sessions.writeJson(session.id, 'workflow.json', workflow);
    await this.sessions.appendEvent(session.id, 'autotune.started', { blockers: workflow.blockers, baseline: baseline.path });
    return { session, workflow };
  }

  async status(sessionId) {
    return this.sessions.readJson(sessionId, 'workflow.json');
  }

  async saveWorkflow(sessionId, workflow, eventType, eventData = {}) {
    workflow.updatedAt = new Date().toISOString();
    await this.sessions.writeJson(sessionId, 'workflow.json', workflow, { overwrite: true });
    await this.sessions.appendEvent(sessionId, eventType, eventData);
    return workflow;
  }

  async advance({ sessionId, ready = false, nexusComplete = false, optimizedAdy = null, uploadComplete = false } = {}) {
    const workflow = await this.status(sessionId);

    if (workflow.status === 'awaiting_position') {
      if (!ready) return { workflow, requiresUser: true, instruction: workflow.nextAction };
      if (!workflow.sweepManifestPath) {
        return { workflow, blocked: true, reason: 'sweep manifest missing' };
      }
      const manifest = await loadManifest(workflow.sweepManifestPath);
      workflow.status = 'measuring';
      workflow.phase = `position_${workflow.currentPosition}`;
      await this.saveWorkflow(sessionId, workflow, 'position.ready', { position: workflow.currentPosition });

      for (let i = workflow.currentChannelIndex; i < workflow.channels.length; i += 1) {
        const channel = workflow.channels[i];
        const spec = manifest.channels[channel];
        if (!spec?.shieldFile || !spec?.stimulusPath) {
          workflow.currentChannelIndex = i;
          workflow.status = 'blocked';
          workflow.blockers.push(`Sweep manifest missing shieldFile/stimulusPath for ${channel}.`);
          await this.saveWorkflow(sessionId, workflow, 'measurement.blocked', { channel, position: workflow.currentPosition });
          return { workflow, blocked: true, reason: `missing sweep mapping for ${channel}` };
        }

        const measured = await this.measurement.measureChannel({
          sessionId,
          position: workflow.currentPosition,
          channel,
          shieldFile: spec.shieldFile,
          stimulusPath: spec.stimulusPath,
          title: `${channel}${workflow.currentPosition}`
        });

        if (measured.manualRequired) {
          workflow.status = 'manual_measurement_required';
          workflow.currentChannelIndex = i;
          workflow.pendingMeasurement = {
            position: workflow.currentPosition,
            channel,
            shieldFile: spec.shieldFile,
            stimulusPath: spec.stimulusPath,
            beforeMeasurementKeys: measured.beforeMeasurementKeys
          };
          await this.saveWorkflow(sessionId, workflow, 'measurement.manual-required', workflow.pendingMeasurement);
          return { workflow, measurement: measured, requiresUser: true };
        }

        if (!measured.record.acceptedForOptimization) {
          workflow.status = 'measurement_failed_quality_gate';
          workflow.currentChannelIndex = i;
          workflow.pendingRetry = { position: workflow.currentPosition, channel };
          await this.saveWorkflow(sessionId, workflow, 'measurement.quality-failed', workflow.pendingRetry);
          return { workflow, measurement: measured, retryRequired: true };
        }

        workflow.completedMeasurements.push({ position: workflow.currentPosition, channel, rewId: measured.record.rewId });
        workflow.currentChannelIndex = i + 1;
        await this.saveWorkflow(sessionId, workflow, 'measurement.accepted', { position: workflow.currentPosition, channel, rewId: measured.record.rewId });
      }

      workflow.currentPosition += 1;
      workflow.currentChannelIndex = 0;
      if (workflow.currentPosition < workflow.positions) {
        workflow.status = 'awaiting_position';
        workflow.nextAction = nextMicInstruction(workflow.currentPosition);
        await this.saveWorkflow(sessionId, workflow, 'position.complete', { position: workflow.currentPosition - 1 });
        return { workflow, requiresUser: true, instruction: workflow.nextAction };
      }

      const rewMdat = this.sessions.path(sessionId, 'rew/theater.mdat');
      try {
        const saved = await this.rew.saveAll(rewMdat, `Raw pre-Nexus measurements for ${sessionId}`);
        workflow.rewMdat = saved.path;
      } catch (error) {
        workflow.blockers.push(`REW MDAT save failed: ${error.message}`);
      }
      workflow.status = 'measurements_complete';
      workflow.phase = 'nexus_prepare';
      await this.saveWorkflow(sessionId, workflow, 'measurements.complete', {
        count: workflow.completedMeasurements.length,
        rewMdat: workflow.rewMdat || null
      });
    }

    if (workflow.status === 'measurements_complete') {
      if (!workflow.baselineAdy) return { workflow, blocked: true, reason: 'baseline .ady missing' };
      const sessionRoot = this.sessions.path(sessionId, '.');
      const prepared = await this.nexus.prepare({
        sessionRoot,
        baselineAdy: workflow.baselineAdy,
        measurements: workflow.completedMeasurements,
        rewMdat: workflow.rewMdat || null
      });
      const optimized = await this.nexus.optimize({ manifestPath: prepared.manifestPath });
      workflow.status = optimized.interactiveRequired ? 'awaiting_nexus' : 'nexus_running_complete';
      workflow.nexus = { prepared, optimized };
      await this.saveWorkflow(sessionId, workflow, 'nexus.prepared', { interactiveRequired: optimized.interactiveRequired });
      return { workflow, nexus: workflow.nexus, requiresUser: optimized.interactiveRequired };
    }

    if (workflow.status === 'awaiting_nexus') {
      if (!nexusComplete || !optimizedAdy) {
        return { workflow, requiresUser: true, instruction: 'Complete A1 Evo Nexus optimization and provide the generated optimized.ady path.' };
      }
      const valid = await this.nexus.validateOptimized(optimizedAdy);
      const copied = await this.sessions.copyArtifact(sessionId, valid.path, 'nexus/optimized.ady');
      workflow.optimizedAdy = copied;
      workflow.status = 'awaiting_upload';
      workflow.phase = 'xt32_transfer';
      await this.saveWorkflow(sessionId, workflow, 'nexus.complete', { optimizedAdy: copied });
      return {
        workflow,
        requiresUser: true,
        instruction: 'Use MultEQ Editor to transfer optimized.ady to Speaker Preset 2. Do not overwrite Speaker Preset 1. Then resume with uploadComplete=true.'
      };
    }

    if (workflow.status === 'awaiting_upload') {
      if (!uploadComplete) {
        return { workflow, requiresUser: true, instruction: 'Confirm the optimized calibration has been transferred to Speaker Preset 2.' };
      }
      workflow.status = 'verification_required';
      workflow.phase = 'post_calibration_verification';
      await this.saveWorkflow(sessionId, workflow, 'xt32.upload-confirmed');
      return {
        workflow,
        next: 'Run level-matched Preset 1 and Preset 2 verification measurements before accepting any further AVR changes.',
        rule: 'No acoustic change is accepted until it is re-measured.'
      };
    }

    return { workflow };
  }

  async resumeManualMeasurement({ sessionId }) {
    const workflow = await this.status(sessionId);
    if (workflow.status !== 'manual_measurement_required' || !workflow.pendingMeasurement) {
      throw new Error('workflow has no pending manual measurement');
    }
    const pending = workflow.pendingMeasurement;
    const captured = await this.measurement.captureManual({
      sessionId,
      position: pending.position,
      channel: pending.channel,
      beforeMeasurementKeys: pending.beforeMeasurementKeys,
      shieldFile: pending.shieldFile
    });
    if (!captured.record.acceptedForOptimization) {
      workflow.status = 'measurement_failed_quality_gate';
      workflow.pendingRetry = { position: pending.position, channel: pending.channel };
      delete workflow.pendingMeasurement;
      await this.saveWorkflow(sessionId, workflow, 'measurement.manual-quality-failed', workflow.pendingRetry);
      return { workflow, captured, retryRequired: true };
    }
    workflow.completedMeasurements.push({ position: pending.position, channel: pending.channel, rewId: captured.record.rewId });
    workflow.currentChannelIndex += 1;
    delete workflow.pendingMeasurement;

    if (workflow.currentChannelIndex < workflow.channels.length) {
      workflow.status = 'awaiting_position';
      workflow.nextAction = `Microphone stays at position ${workflow.currentPosition}. Continue with ${workflow.channels[workflow.currentChannelIndex]}.`;
    } else {
      workflow.currentPosition += 1;
      workflow.currentChannelIndex = 0;
      if (workflow.currentPosition < workflow.positions) {
        workflow.status = 'awaiting_position';
        workflow.nextAction = nextMicInstruction(workflow.currentPosition);
      } else {
        const rewMdat = this.sessions.path(sessionId, 'rew/theater.mdat');
        try {
          const saved = await this.rew.saveAll(rewMdat, `Raw pre-Nexus measurements for ${sessionId}`);
          workflow.rewMdat = saved.path;
        } catch (error) {
          workflow.blockers.push(`REW MDAT save failed: ${error.message}`);
        }
        workflow.status = 'measurements_complete';
        workflow.phase = 'nexus_prepare';
      }
    }

    await this.saveWorkflow(sessionId, workflow, 'measurement.manual-accepted', { position: pending.position, channel: pending.channel, rewId: captured.record.rewId });
    return { workflow, captured, requiresUser: workflow.status === 'awaiting_position', instruction: workflow.nextAction || null };
  }

  async finalizeVerification({ sessionId, baselineMetrics, candidateMetrics, changes = [], remainingIssues = [], minimumGain = 0.5, majorRegression = 8 }) {
    const workflow = await this.status(sessionId);
    if (workflow.status !== 'verification_required') {
      throw new Error(`verification can only be finalized from verification_required, current status is ${workflow.status}`);
    }
    const baseline = scoreCalibration(baselineMetrics);
    const candidate = scoreCalibration(candidateMetrics);
    const comparison = compareScores(baseline, candidate, { minimumGain, majorRegression });
    if (baseline.confidence !== 'high' || candidate.confidence !== 'high') {
      comparison.accepted = false;
      comparison.confidenceGate = 'High-confidence measured evidence is required for final acceptance.';
    }

    const result = {
      verifiedAt: new Date().toISOString(),
      baselineMetrics,
      candidateMetrics,
      baseline,
      candidate,
      comparison,
      changes,
      remainingIssues
    };
    await this.sessions.writeJson(sessionId, 'optimized/verification.json', result);

    const report = renderCalibrationReport({
      receiver: 'Denon AVR-X3700H',
      baseline,
      candidate,
      comparison,
      changes,
      remainingIssues
    });
    const reportPath = this.sessions.path(sessionId, 'report.md');
    await writeFile(reportPath, report, { encoding: 'utf8', flag: 'wx' });

    workflow.verification = { path: this.sessions.path(sessionId, 'optimized/verification.json'), reportPath, accepted: comparison.accepted };
    workflow.status = comparison.accepted ? 'complete' : 'regression_rejected';
    workflow.phase = 'verification_complete';
    workflow.nextAction = comparison.accepted
      ? 'Measured verification passed. Preset 2 may remain selected.'
      : 'Candidate rejected. Return to or keep Speaker Preset 1 until another optimized candidate passes measured verification.';
    await this.saveWorkflow(sessionId, workflow, comparison.accepted ? 'verification.accepted' : 'verification.rejected', {
      baselineScore: baseline.score,
      candidateScore: candidate.score,
      comparison
    });
    return { workflow, verification: result, reportPath, nextAction: workflow.nextAction };
  }
}
