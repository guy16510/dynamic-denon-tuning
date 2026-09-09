import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

function unavailable(error) {
  return { unavailable: error?.message || String(error) };
}

function microphoneUsable(result) {
  return result?.usable === true || result?.valid === true || result?.ready === true;
}

export class HardwareProofService {
  constructor({ denon, rew, shield, measurement, sessions }) {
    this.denon = denon;
    this.rew = rew;
    this.shield = shield;
    this.measurement = measurement;
    this.sessions = sessions;
  }

  async inspect({ channel = 'TFL', fileName, stimulusPath, expectedPreset = 1 } = {}) {
    const blockers = [];
    const [measurementPreflight, rewContract, shieldFiles, denonInspect] = await Promise.all([
      this.measurement.preflight().catch(error => unavailable(error)),
      this.rew.measurementContract().catch(error => unavailable(error)),
      fileName ? this.shield.listSweeps(channel).catch(error => unavailable(error)) : Promise.resolve([]),
      this.denon.inspect().catch(error => unavailable(error))
    ]);

    let stimulus = { configured: Boolean(stimulusPath), path: stimulusPath ? resolve(stimulusPath) : null, readable: false };
    if (!stimulusPath) blockers.push('stimulusPath is required for the REW Measure From File proof.');
    else {
      try {
        await access(stimulus.path, constants.R_OK);
        stimulus.readable = true;
      } catch (error) {
        stimulus = { ...stimulus, error: error.message };
        blockers.push(`Local REW stimulus file is not readable: ${stimulus.path}`);
      }
    }

    if (!fileName) blockers.push('fileName is required for the Shield channel proof.');
    else if (shieldFiles.unavailable) blockers.push(`Could not list Shield sweeps for ${channel}: ${shieldFiles.unavailable}`);
    else if (!shieldFiles.includes(fileName)) blockers.push(`Shield sweep ${fileName} was not found in the ${channel} folder.`);

    if (measurementPreflight.unavailable) blockers.push(`Measurement preflight failed: ${measurementPreflight.unavailable}`);
    else blockers.push(...(measurementPreflight.blockers || []));
    if (rewContract.unavailable) blockers.push(`REW measurement contract unavailable: ${rewContract.unavailable}`);
    else if (rewContract.valid === false) blockers.push(...rewContract.blockers);

    const activePreset = denonInspect?.presetStatus?.activeSpeakerPreset ?? null;
    if (denonInspect.unavailable) blockers.push(`Denon inspection unavailable: ${denonInspect.unavailable}`);
    else if (activePreset == null) blockers.push('Active Speaker Preset could not be verified. No audio will be emitted until preset state is known.');
    else if (expectedPreset != null && activePreset !== expectedPreset) blockers.push(`Speaker Preset ${activePreset} is active, expected Speaker Preset ${expectedPreset}.`);

    const uniqueBlockers = [...new Set(blockers)];
    return {
      channel,
      fileName: fileName || null,
      expectedPreset,
      activePreset,
      stimulus,
      shieldFiles,
      measurementPreflight,
      rewContract,
      denonInspect,
      ready: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      next: uniqueBlockers.length
        ? (activePreset != null && activePreset !== expectedPreset ? `Select Speaker Preset ${expectedPreset}, then resume.` : 'Resolve the blockers and run the proof again without confirmation.')
        : 'Hardware path is ready for one audible proof sweep. Re-run with confirmAudible=true.'
    };
  }

  async run({ channel = 'TFL', fileName, stimulusPath, expectedPreset = 1, confirmAudible = false } = {}) {
    const plan = await this.inspect({ channel, fileName, stimulusPath, expectedPreset });
    if (!plan.ready) return { executed: false, blocked: true, plan };
    if (!confirmAudible) {
      return {
        executed: false,
        requiresConfirmation: true,
        plan,
        warning: `This will play one encoded ${channel} sweep at or below the configured measurement-volume ceiling.`
      };
    }

    const microphone = await this.rew.inputLevelCheck({ durationMs: 3000, confirm: true });
    if (!microphoneUsable(microphone)) {
      return {
        executed: false,
        blocked: true,
        plan,
        microphone,
        reason: 'REW microphone input proof did not provide an affirmative usable/valid/ready result. No audio was emitted.'
      };
    }
    const session = await this.sessions.create({
      purpose: 'hardware-proof',
      receiver: 'Denon AVR-X3700H',
      channel,
      expectedPreset,
      fileName,
      stimulusPath: resolve(stimulusPath)
    });
    await this.sessions.writeJson(session.id, 'proof/preflight.json', { ...plan, microphone });
    await this.sessions.appendEvent(session.id, 'hardware-proof.started', { channel, fileName, expectedPreset });

    const measured = await this.measurement.measureChannel({
      sessionId: session.id,
      position: 0,
      channel,
      shieldFile: fileName,
      stimulusPath: resolve(stimulusPath),
      title: `PROOF-${channel}`,
      notes: `dynamic-denon-tuning hardware proof channel=${channel}`,
      verifyAtmos: true,
      expectedPreset,
      measurementType: 'hardware-proof'
    });

    if (measured.wrongPreset) return { executed: false, blocked: true, session, measurement: measured, next: measured.next };
    if (measured.manualRequired) {
      const proof = {
        schemaVersion: 1,
        status: 'manual_measurement_required',
        channel,
        expectedPreset,
        fileName,
        stimulusPath: resolve(stimulusPath),
        beforeMeasurementKeys: measured.beforeMeasurementKeys,
        microphone,
        startedAt: new Date().toISOString()
      };
      await this.sessions.writeJson(session.id, 'proof/state.json', proof);
      return {
        executed: true,
        completed: false,
        manualRequired: true,
        session,
        proof,
        measurement: measured,
        next: 'In REW, start the prepared measurement so it is waiting for file playback. Then call theater_hardware_proof_resume with this sessionId. The server will re-check the preset and start the Shield sweep.'
      };
    }

    return this.finalize(session.id, measured, microphone);
  }

  async resume({ sessionId }) {
    const proof = await this.sessions.readJson(sessionId, 'proof/state.json');
    if (proof.status !== 'manual_measurement_required') throw new Error(`hardware proof is not awaiting a manual measurement, status=${proof.status}`);
    if (!microphoneUsable(proof.microphone)) {
      return { executed: false, blocked: true, sessionId, reason: 'Stored microphone usability evidence is missing or ambiguous. Re-run the hardware proof preflight.' };
    }
    const measured = await this.measurement.captureManual({
      sessionId,
      position: 0,
      channel: proof.channel,
      beforeMeasurementKeys: proof.beforeMeasurementKeys,
      shieldFile: proof.fileName,
      verifyAtmos: true,
      expectedPreset: proof.expectedPreset,
      measurementType: 'hardware-proof'
    });
    if (measured.wrongPreset) return { executed: false, blocked: true, sessionId, measurement: measured, next: measured.next };
    return this.finalize(sessionId, measured, proof.microphone);
  }

  async finalize(sessionId, measured, microphone) {
    const passed = microphoneUsable(microphone)
      && measured.record.acceptedForOptimization === true
      && measured.record.atmos?.verified === true;
    const result = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      passed,
      channel: measured.record.channel,
      rewId: measured.record.rewId,
      attempt: measured.record.attempt,
      microphone,
      atmos: measured.record.atmos,
      quality: measured.record.quality,
      gate: measured.record.gate,
      evidencePath: measured.path,
      rule: 'A hardware proof passes only when microphone usability is affirmative, REW captured valid evidence, and the receiver reported Atmos during the encoded sweep.'
    };
    const resultPath = await this.sessions.writeJson(sessionId, 'proof/result.json', result);
    const proof = {
      schemaVersion: 1,
      status: passed ? 'passed' : 'failed',
      resultPath,
      completedAt: result.completedAt
    };
    try {
      await this.sessions.writeJson(sessionId, 'proof/state.json', proof, { overwrite: true });
    } catch {
      await this.sessions.writeJson(sessionId, 'proof/state.json', proof);
    }
    await this.sessions.appendEvent(sessionId, passed ? 'hardware-proof.passed' : 'hardware-proof.failed', result);
    return { executed: true, completed: true, passed, sessionId, result, resultPath };
  }
}
