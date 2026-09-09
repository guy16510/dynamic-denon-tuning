import { CapabilityError, SafetyError } from '../lib/errors.js';

function statusLines(payload) {
  if (Array.isArray(payload)) return payload.map(String);
  if (Array.isArray(payload?.responses)) return payload.responses.map(String);
  if (Array.isArray(payload?.raw)) return payload.raw.map(String);
  if (Array.isArray(payload?.status?.responses)) return payload.status.responses.map(String);
  if (Array.isArray(payload?.status?.raw)) return payload.status.raw.map(String);
  return [];
}

function decodeMasterVolume(line) {
  const match = String(line).trim().match(/^MV(\d{2,3})$/i);
  if (!match) return null;
  const raw = match[1];
  let scale;
  if (raw.length === 3 && raw.endsWith('5')) scale = Number(raw.slice(0, 2)) + 0.5;
  else scale = Number(raw);
  if (!Number.isFinite(scale)) return null;
  return scale - 80;
}

function presetValue(value) {
  if (value === 1 || value === 2) return value;
  const text = String(value ?? '').trim();
  const match = text.match(/^(?:SPEAKER\s*)?PRESET\s*([12])$/i) || text.match(/^([12])$/);
  return match ? Number(match[1]) : null;
}

export function normalizeSpeakerPresetStatus(payload) {
  const candidates = [];
  const add = (path, value) => {
    const parsed = presetValue(value);
    if (parsed != null) candidates.push({ path, value: parsed });
  };
  add('activeSpeakerPreset', payload?.activeSpeakerPreset);
  add('speakerPreset', payload?.speakerPreset);
  add('activePreset', payload?.activePreset);
  add('status.activeSpeakerPreset', payload?.status?.activeSpeakerPreset);
  add('status.speakerPreset', payload?.status?.speakerPreset);
  add('preset.activeSpeakerPreset', payload?.preset?.activeSpeakerPreset);

  const unique = [...new Set(candidates.map(candidate => candidate.value))];
  return {
    activeSpeakerPreset: unique.length === 1 ? unique[0] : null,
    confidence: unique.length === 1 ? 'high' : 'insufficient',
    evidence: candidates,
    ...(unique.length > 1 ? { blocker: `Conflicting Speaker Preset evidence: ${unique.join(', ')}` } : {}),
    ...(unique.length === 0 ? { blocker: 'No recognized active Speaker Preset field was present.' } : {}),
    raw: payload
  };
}

export function parseDenonStatus(payload) {
  const lines = statusLines(payload);
  const state = {
    power: null,
    input: null,
    mute: null,
    volumeDb: null,
    soundMode: null
  };

  for (const raw of lines) {
    const line = String(raw).trim();
    if (/^PWON$/i.test(line)) state.power = 'on';
    else if (/^PWSTANDBY$/i.test(line)) state.power = 'standby';
    else if (/^SI/i.test(line)) state.input = line.slice(2).trim().toUpperCase();
    else if (/^MUON$/i.test(line)) state.mute = true;
    else if (/^MUOFF$/i.test(line)) state.mute = false;
    else if (/^MV\d/i.test(line)) state.volumeDb = decodeMasterVolume(line);
    else if (/^MS/i.test(line)) state.soundMode = line.slice(2).trim();
  }

  return { state, lines };
}

export class DenonAdapter {
  constructor(config, evoburrow) {
    this.config = config;
    this.evoburrow = evoburrow;
  }

  async status() {
    const raw = await this.evoburrow.call('denon_status', {
      host: this.config.host,
      port: this.config.port
    });
    return { raw, ...parseDenonStatus(raw) };
  }

  async inspect() {
    const [probe, status, models, presetRaw] = await Promise.all([
      this.evoburrow.call('denon_probe', { host: this.config.host }),
      this.status(),
      this.evoburrow.call('receiver_models', { brand: 'Denon', model: 'X3700H' }).catch(error => ({ unavailable: error.message })),
      this.evoburrow.call('calibration_preset_status', { host: this.config.host, port: this.config.port, ...(this.evoburrow.config.home ? { home: this.evoburrow.config.home } : {}) }).catch(error => ({ unavailable: error.message }))
    ]);
    const presetStatus = presetRaw?.unavailable
      ? { activeSpeakerPreset: null, confidence: 'insufficient', blocker: `Preset inspection unavailable: ${presetRaw.unavailable}`, raw: presetRaw }
      : normalizeSpeakerPresetStatus(presetRaw);
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

  assertSafeAudibleTest({ expectedInput, expectedMaxVolumeDb = -15 }) {
    if (this.config.measurementVolumeDb > expectedMaxVolumeDb) {
      throw new SafetyError('Configured measurement volume exceeds the safety ceiling', {
        configured: this.config.measurementVolumeDb,
        ceiling: expectedMaxVolumeDb
      });
    }
    if (expectedInput && String(expectedInput).toUpperCase() !== String(this.config.shieldInput).toUpperCase()) {
      throw new SafetyError('Expected measurement input does not match configured Shield input');
    }
  }

  async preflightAudibleTest({ expectedInput = this.config.shieldInput, maximumVolumeDb = this.config.measurementVolumeDb } = {}) {
    this.assertSafeAudibleTest({ expectedInput });
    const live = await this.status();
    const expected = String(expectedInput || '').trim().toUpperCase();
    const blockers = [];

    if (live.state.power !== 'on') blockers.push(`Receiver power must be ON, reported ${live.state.power ?? 'unknown'}.`);
    if (!live.state.input) blockers.push('Receiver input could not be verified from Denon status.');
    else if (expected && live.state.input !== expected) blockers.push(`Receiver input is ${live.state.input}, expected ${expected}.`);
    if (!Number.isFinite(live.state.volumeDb)) blockers.push('Receiver master volume could not be verified from Denon status.');
    else if (live.state.volumeDb > maximumVolumeDb + 0.01) blockers.push(`Receiver volume ${live.state.volumeDb.toFixed(1)} dB is louder than the allowed ${maximumVolumeDb.toFixed(1)} dB measurement ceiling.`);
    if (live.state.mute === null) blockers.push('Receiver mute state could not be verified from Denon status.');
    else if (live.state.mute) blockers.push('Receiver is muted.');

    return {
      ready: blockers.length === 0,
      expected: { input: expected, maximumVolumeDb },
      state: live.state,
      blockers,
      evidence: live.lines
    };
  }

  async requireSafeAudibleTest(options = {}) {
    const result = await this.preflightAudibleTest(options);
    if (!result.ready) {
      throw new SafetyError('Live receiver state is not safe/ready for an audible measurement', result);
    }
    return result;
  }

  async verifyAtmos({ timeoutMs = 5000, pollMs = 400 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    do {
      last = await this.status();
      const soundMode = String(last?.state?.soundMode || '').trim();
      if (/\bATMOS\b/i.test(soundMode)) {
        return {
          verified: true,
          status: last,
          soundMode,
          evidence: `Live Denon sound mode reports ${soundMode}.`
        };
      }
      if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, pollMs));
    } while (Date.now() < deadline);
    return {
      verified: false,
      status: last,
      soundMode: last?.state?.soundMode ?? null,
      evidence: `Live Denon sound mode did not report Atmos within ${timeoutMs} ms.`
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
}
