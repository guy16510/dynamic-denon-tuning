import { CapabilityError, SafetyError } from '../lib/errors.js';

export class DenonAdapter {
  constructor(config, evoburrow) {
    this.config = config;
    this.evoburrow = evoburrow;
  }

  async inspect() {
    const [probe, status, models, presetStatus] = await Promise.all([
      this.evoburrow.call('denon_probe', { host: this.config.host }),
      this.evoburrow.call('denon_status', { host: this.config.host, port: this.config.port }),
      this.evoburrow.call('receiver_models', { brand: 'Denon', model: 'X3700H' }).catch(error => ({ unavailable: error.message })),
      this.evoburrow.call('calibration_preset_status', { host: this.config.host, port: this.config.port, ...(this.evoburrow.config.home ? { home: this.evoburrow.config.home } : {}) }).catch(error => ({ unavailable: error.message }))
    ]);
    return { host: this.config.host, probe, status, models, presetStatus };
  }

  async snapshot() {
    return this.evoburrow.call('denon_snapshot', {
      host: this.config.host,
      port: this.config.port,
      save: false,
      confirmSave: false
    });
  }

  async prepareMeasurementState({ confirm = false } = {}) {
    const requested = {
      input: this.config.shieldInput,
      volumeDb: this.config.measurementVolumeDb,
      mute: false
    };

    if (!this.config.allowWrites) {
      return {
        applied: false,
        blocked: true,
        requested,
        reason: 'ALLOW_RECEIVER_WRITES is disabled. Read-only preflight is the default.'
      };
    }
    if (!confirm) {
      return {
        applied: false,
        requiresConfirmation: true,
        requested,
        reason: 'Receiver state change requires confirm=true.'
      };
    }

    const proposed = await this.evoburrow.call('denon_propose_changes', {
      host: this.config.host,
      port: this.config.port,
      ...(this.evoburrow.config.home ? { home: this.evoburrow.config.home } : {}),
      changes: requested
    });
    const executed = await this.evoburrow.call('denon_execute_plan', {
      plan: proposed.plan,
      confirmationToken: proposed.confirmationToken,
      confirm: true
    });
    return { applied: true, proposed, executed };
  }

  async verifyAtmos() {
    const status = await this.evoburrow.call('denon_status', {
      host: this.config.host,
      port: this.config.port
    });
    const text = JSON.stringify(status).toUpperCase();
    return {
      verified: /ATMOS/.test(text),
      status,
      evidence: /ATMOS/.test(text) ? 'Receiver status contains ATMOS.' : 'Receiver status does not currently contain ATMOS.'
    };
  }

  unsupportedCalibrationWrite(kind, requested) {
    throw new CapabilityError(`Direct ${kind} writes are not exposed by the current EvoBurrow safety surface`, {
      requested,
      policy: 'Do not bypass EvoBurrow with arbitrary Denon protocol strings.',
      remediation: `Add ${kind} as an allowlisted, baseline-bound, verified EvoBurrow capability before enabling it here.`
    });
  }

  async setDistance(channel, value) { return this.unsupportedCalibrationWrite('distance', { channel, value }); }
  async setLevel(channel, value) { return this.unsupportedCalibrationWrite('channel trim', { channel, value }); }
  async setCrossover(channel, value) { return this.unsupportedCalibrationWrite('crossover', { channel, value }); }
  async selectPreset(preset) { return this.unsupportedCalibrationWrite('speaker preset', { preset }); }

  assertSafeAudibleTest({ expectedInput, expectedMaxVolumeDb = -15 }) {
    if (this.config.measurementVolumeDb > expectedMaxVolumeDb) {
      throw new SafetyError('Configured measurement volume exceeds the safety ceiling', {
        configured: this.config.measurementVolumeDb,
        ceiling: expectedMaxVolumeDb
      });
    }
    if (expectedInput && expectedInput !== this.config.shieldInput) {
      throw new SafetyError('Expected measurement input does not match configured Shield input');
    }
  }
}
