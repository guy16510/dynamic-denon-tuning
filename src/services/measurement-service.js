import { validateTrace, validateMeasurementRecord } from '../safety/validation.js';

function unavailable(error) {
  return { unavailable: error?.message || String(error) };
}

export class MeasurementService {
  constructor({ rew, shield, denon, sessions }) {
    this.rew = rew;
    this.shield = shield;
    this.denon = denon;
    this.sessions = sessions;
  }

  async preflight() {
    const [rew, shield, denon, autoMeasure] = await Promise.all([
      this.rew.status().catch(error => unavailable(error)),
      this.shield.status().catch(error => unavailable(error)),
      this.denon.preflightAudibleTest().catch(error => unavailable(error)),
      this.rew.detectAutoMeasureCapability().catch(error => ({ automated: false, ...unavailable(error) }))
    ]);
    const blockers = [];
    if (rew.unavailable) blockers.push(`REW unavailable: ${rew.unavailable}`);
    if (rew.contract?.valid === false) blockers.push(...(rew.contract.blockers || ['REW Measure From File contract is incomplete.']));
    if (shield.unavailable) blockers.push(`Shield unavailable: ${shield.unavailable}`);
    if (denon.unavailable) blockers.push(`Denon audible preflight unavailable: ${denon.unavailable}`);
    else if (denon.ready === false) blockers.push(...denon.blockers);
    return {
      rew,
      shield,
      denon,
      autoMeasure,
      blockers: [...new Set(blockers)],
      readyForAudibleMeasurement: blockers.length === 0,
      fullyAutomatic: blockers.length === 0 && autoMeasure.automated === true
    };
  }

  async buildRecord({ sessionId, position, channel, captured, shieldFile = null, playback = null, atmos = null, manualCapture = false, measurementType = 'verification', expectedPreset = null }) {
    const [frequency, impulse, distortion] = await Promise.all([
      this.rew.trace(captured.id, 'frequency-response'),
      this.rew.trace(captured.id, 'impulse-response').catch(error => ({ unavailable: error.message })),
      this.rew.trace(captured.id, 'distortion').catch(error => ({ unavailable: error.message }))
    ]);
    const quality = validateTrace(frequency);
    const allocation = await this.sessions.allocateMeasurementAttempt(sessionId, {
      position,
      channel,
      rewId: String(captured.id)
    });
    const record = {
      schemaVersion: 4,
      capturedAt: new Date().toISOString(),
      position,
      channel,
      measurementType,
      expectedChannel: channel,
      ...(expectedPreset != null ? { preset: expectedPreset, expectedPreset } : {}),
      rewId: String(captured.id),
      attempt: allocation.number,
      summary: captured.summary,
      shieldFile,
      ...(playback ? { shield: playback } : {}),
      ...(atmos ? { atmos } : {}),
      quality,
      traces: { frequencyResponse: frequency, impulseResponse: impulse, distortion },
      ...(manualCapture ? { manualCapture: true } : {})
    };
    const gate = validateMeasurementRecord(record);
    const atmosRequired = Boolean(shieldFile) || measurementType === 'hardware-proof' || measurementType === 'post-calibration-verification';
    const atmosPassed = atmosRequired ? atmos?.verified === true : atmos?.verified !== false;
    record.acceptedForOptimization = gate.valid && atmosPassed;
    record.gate = {
      ...gate,
      atmosRequired,
      atmosPassed,
      ...(atmosRequired && !atmosPassed ? { issues: [...gate.issues, 'missing or failed affirmative Atmos verification'] } : {})
    };
    const path = await this.sessions.writeJson(sessionId, allocation.relativePath, record);
    let accepted = null;
    if (record.acceptedForOptimization) {
      accepted = await this.sessions.acceptMeasurementAttempt(sessionId, allocation.relativePath, record);
    }
    await this.sessions.appendEvent(sessionId, manualCapture ? 'measurement.manual-captured' : 'measurement.completed', {
      position,
      channel,
      measurementType,
      expectedPreset,
      attempt: allocation.number,
      rewId: record.rewId,
      path: allocation.relativePath,
      accepted: record.acceptedForOptimization,
      acceptedPointer: accepted?.pointerPath || null,
      atmosRequired,
      atmosVerified: atmos?.verified ?? null,
      distortionAvailable: !distortion.unavailable
    });
    return { completed: true, path, record, accepted };
  }

  async measureChannel({ sessionId, position, channel, shieldFile, stimulusPath, title, notes, verifyAtmos = true, expectedPreset = null, measurementType = 'verification' }) {
    if (expectedPreset != null) {
      const inspected = await this.denon.inspect();
      const active = inspected?.presetStatus?.activeSpeakerPreset ?? null;
      if (active !== expectedPreset) {
        return {
          completed: false,
          blocked: true,
          wrongPreset: true,
          expectedPreset,
          activePreset: active,
          next: `Select Speaker Preset ${expectedPreset}, then resume.`
        };
      }
    }
    await this.denon.requireSafeAudibleTest({ expectedInput: this.denon.config.shieldInput });

    const configuration = await this.rew.configureFilePlayback({ stimulusPath });
    const started = await this.rew.startMeasurement({
      title: title || `${channel}${position}`,
      notes: notes || `dynamic-denon-tuning position=${position} channel=${channel}`
    });

    if (started.manualRequired) {
      await this.sessions.appendEvent(sessionId, 'measurement.manual-required', {
        position,
        channel,
        measurementType,
        expectedPreset,
        shieldFile,
        stimulusPath,
        started
      });
      return {
        completed: false,
        manualRequired: true,
        position,
        channel,
        expectedPreset,
        measurementType,
        configuration,
        ...started,
        next: 'Start the prepared measurement in REW so it is waiting for file playback, then resume this workflow. The resume step will start the Shield sweep and capture the result.'
      };
    }

    let playback;
    try {
      playback = await this.shield.playSweep(channel, shieldFile);
      await new Promise(resolve => setTimeout(resolve, 500));
      const atmos = verifyAtmos ? await this.denon.verifyAtmos() : { verified: null, skipped: true };
      const captured = await this.rew.waitForNewMeasurement({ beforeMeasurementKeys: started.beforeMeasurementKeys });
      return this.buildRecord({ sessionId, position, channel, captured, shieldFile, playback, atmos, measurementType, expectedPreset });
    } finally {
      await this.shield.stop().catch(() => {});
    }
  }

  async captureManual({ sessionId, position, channel, beforeMeasurementKeys, shieldFile = null, verifyAtmos = true, expectedPreset = null, measurementType = 'verification' }) {
    if (expectedPreset != null) {
      const inspected = await this.denon.inspect();
      const active = inspected?.presetStatus?.activeSpeakerPreset ?? null;
      if (active !== expectedPreset) {
        return {
          completed: false,
          blocked: true,
          wrongPreset: true,
          expectedPreset,
          activePreset: active,
          next: `Select Speaker Preset ${expectedPreset}, then resume.`
        };
      }
    }
    await this.denon.requireSafeAudibleTest({ expectedInput: this.denon.config.shieldInput });
    let playback = null;
    try {
      let captured;
      let atmos = null;
      if (shieldFile) {
        playback = await this.shield.playSweep(channel, shieldFile);
        await new Promise(resolve => setTimeout(resolve, 500));
        atmos = verifyAtmos ? await this.denon.verifyAtmos() : { verified: null, skipped: true };
        captured = await this.rew.waitForNewMeasurement({ beforeMeasurementKeys });
      } else {
        captured = await this.rew.captureNewMeasurement({ beforeMeasurementKeys });
      }
      return this.buildRecord({
        sessionId,
        position,
        channel,
        captured,
        shieldFile,
        playback,
        atmos,
        manualCapture: true,
        measurementType,
        expectedPreset
      });
    } finally {
      if (playback) await this.shield.stop().catch(() => {});
    }
  }
}
