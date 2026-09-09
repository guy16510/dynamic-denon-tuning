import { validateTrace, validateMeasurementRecord } from '../safety/validation.js';

export class MeasurementService {
  constructor({ rew, shield, denon, sessions }) {
    this.rew = rew;
    this.shield = shield;
    this.denon = denon;
    this.sessions = sessions;
  }

  async preflight() {
    const [rew, shield] = await Promise.all([
      this.rew.status(),
      this.shield.status()
    ]);
    const autoMeasure = await this.rew.detectAutoMeasureCapability().catch(error => ({ automated: false, error: error.message }));
    return { rew, shield, autoMeasure };
  }

  async measureChannel({ sessionId, position, channel, shieldFile, stimulusPath, title, notes, verifyAtmos = true }) {
    this.denon.assertSafeAudibleTest({ expectedInput: this.denon.config.shieldInput });

    const configuration = await this.rew.configureFilePlayback({ stimulusPath });
    const started = await this.rew.startMeasurement({
      title: title || `${channel}${position}`,
      notes: notes || `dynamic-denon-tuning position=${position} channel=${channel}`
    });

    if (started.manualRequired) {
      await this.sessions.appendEvent(sessionId, 'measurement.manual-required', {
        position,
        channel,
        shieldFile,
        stimulusPath,
        started
      });
      return {
        completed: false,
        manualRequired: true,
        position,
        channel,
        configuration,
        ...started,
        next: 'Start the prepared measurement in REW, then trigger shield_play_sweep for this channel and call measurement_capture_new.'
      };
    }

    let playback;
    try {
      playback = await this.shield.playSweep(channel, shieldFile);
      await new Promise(resolve => setTimeout(resolve, 500));
      const atmos = verifyAtmos ? await this.denon.verifyAtmos() : { verified: null, skipped: true };
      const captured = await this.rew.waitForNewMeasurement({ beforeMeasurementKeys: started.beforeMeasurementKeys });
      const frequency = await this.rew.trace(captured.id, 'frequency-response');
      const impulse = await this.rew.trace(captured.id, 'impulse-response').catch(error => ({ unavailable: error.message }));
      const quality = validateTrace(frequency);
      const record = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        position,
        channel,
        expectedChannel: channel,
        rewId: String(captured.id),
        summary: captured.summary,
        shield: playback,
        atmos,
        quality,
        traces: {
          frequencyResponse: frequency,
          impulseResponse: impulse
        }
      };
      const gate = validateMeasurementRecord(record);
      record.acceptedForOptimization = gate.valid && (atmos.verified !== false);
      record.gate = gate;
      const path = await this.sessions.writeJson(sessionId, `measurements/position-${position}/${channel}.json`, record);
      await this.sessions.appendEvent(sessionId, 'measurement.completed', { position, channel, rewId: record.rewId, accepted: record.acceptedForOptimization });
      return { completed: true, path, record };
    } finally {
      await this.shield.stop().catch(() => {});
    }
  }

  async captureManual({ sessionId, position, channel, beforeMeasurementKeys, shieldFile = null }) {
    const captured = await this.rew.captureNewMeasurement({ beforeMeasurementKeys });
    const frequency = await this.rew.trace(captured.id, 'frequency-response');
    const impulse = await this.rew.trace(captured.id, 'impulse-response').catch(error => ({ unavailable: error.message }));
    const quality = validateTrace(frequency);
    const record = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      position,
      channel,
      expectedChannel: channel,
      rewId: String(captured.id),
      summary: captured.summary,
      shieldFile,
      quality,
      traces: { frequencyResponse: frequency, impulseResponse: impulse },
      manualCapture: true
    };
    const gate = validateMeasurementRecord(record);
    record.acceptedForOptimization = gate.valid;
    record.gate = gate;
    const path = await this.sessions.writeJson(sessionId, `measurements/position-${position}/${channel}.json`, record);
    await this.sessions.appendEvent(sessionId, 'measurement.manual-captured', { position, channel, rewId: record.rewId, accepted: record.acceptedForOptimization });
    return { completed: true, path, record };
  }
}
