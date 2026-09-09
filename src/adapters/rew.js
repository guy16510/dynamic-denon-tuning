import { CapabilityError } from '../lib/errors.js';

function asEntries(measurements) {
  if (Array.isArray(measurements)) return measurements.map((value, index) => [String(index + 1), value]);
  return Object.entries(measurements || {});
}

export class RewAdapter {
  constructor(config, evoburrow) {
    this.config = config;
    this.evoburrow = evoburrow;
  }

  async request(path, { method = 'GET', body, timeoutMs = 5000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.config.url}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      if (!response.ok) {
        const error = new Error(`REW ${response.status}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
        error.status = response.status;
        error.body = value;
        throw error;
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    const [probe, audio, version, commands, playbackMode, measurementMode] = await Promise.all([
      this.evoburrow.call('rew_probe', {}).catch(error => ({ unavailable: error.message })),
      this.evoburrow.call('rew_audio_inventory', {}).catch(error => ({ unavailable: error.message })),
      this.request('/version').catch(error => ({ unavailable: error.message })),
      this.request('/measure/commands').catch(error => ({ unavailable: error.message })),
      this.request('/measure/playback-mode').catch(error => ({ unavailable: error.message })),
      this.request('/measure/measurement-mode').catch(error => ({ unavailable: error.message }))
    ]);
    return { url: this.config.url, probe, audio, version, commands, playbackMode, measurementMode };
  }

  async detectAutoMeasureCapability() {
    if (this.config.measurementMode === 'manual') {
      return { automated: false, mode: 'manual', reason: 'REW_MEASUREMENT_MODE=manual' };
    }
    const commands = await this.request('/measure/commands');
    const spl = Array.isArray(commands) ? commands.find(command => /^SPL$/i.test(String(command))) : null;
    if (!spl) return { automated: false, mode: this.config.measurementMode, reason: 'REW does not advertise an SPL measurement command.' };
    return {
      automated: this.config.measurementMode === 'pro',
      mode: this.config.measurementMode,
      probeOnly: this.config.measurementMode === 'auto',
      command: spl,
      note: 'REW requires a Pro upgrade to trigger automated sweep measurements through the API. In auto mode the license is confirmed only when an actual measurement is attempted.'
    };
  }

  async inputLevelCheck({ durationMs = 4000, confirm = false } = {}) {
    return this.evoburrow.call('rew_input_level_check', { durationMs, confirm });
  }

  async configureFilePlayback({ stimulusPath, measurementMode = 'SPL', playbackMode = 'From file' }) {
    if (!stimulusPath) throw new Error('stimulusPath is required');
    await this.request('/measure/file-playback-stimulus', { method: 'POST', body: stimulusPath });
    await this.request('/measure/playback-mode', { method: 'POST', body: playbackMode });
    await this.request('/measure/measurement-mode', { method: 'POST', body: measurementMode });
    const [stimulus, actualPlayback, actualMeasurement] = await Promise.all([
      this.request('/measure/file-playback-stimulus'),
      this.request('/measure/playback-mode'),
      this.request('/measure/measurement-mode')
    ]);
    return { configured: true, stimulus, playbackMode: actualPlayback, measurementMode: actualMeasurement };
  }

  async listMeasurements() {
    return this.request('/measurements');
  }

  async measurementKeys() {
    return asEntries(await this.listMeasurements()).map(([id, value]) => value?.uuid || id);
  }

  async prepareMeasurementMetadata({ title, notes, startDelaySeconds = 2 }) {
    if (notes) await this.request('/measure/notes', { method: 'POST', body: notes });
    if (title) {
      const naming = await this.request('/measure/naming').catch(() => ({}));
      await this.request('/measure/naming', {
        method: 'POST',
        body: { ...(naming && typeof naming === 'object' ? naming : {}), name: title, prefix: title }
      }).catch(() => {});
    }
    await this.request('/measure/start-delay', { method: 'POST', body: startDelaySeconds }).catch(() => {});
  }

  async startMeasurement({ title, notes, startDelaySeconds = 2, manual = false } = {}) {
    const beforeMeasurementKeys = await this.measurementKeys();
    await this.prepareMeasurementMetadata({ title, notes, startDelaySeconds });

    if (manual || this.config.measurementMode === 'manual') {
      return {
        started: false,
        manualRequired: true,
        beforeMeasurementKeys,
        instruction: 'Start the prepared REW measurement manually, then resume the workflow.'
      };
    }

    try {
      await this.request('/measure/command', {
        method: 'POST',
        body: { command: 'SPL', parameters: [] },
        timeoutMs: 10000
      });
      return { started: true, manualRequired: false, beforeMeasurementKeys };
    } catch (error) {
      if (error.status === 401 || /Pro upgrade/i.test(error.message)) {
        if (this.config.measurementMode === 'pro') throw error;
        return {
          started: false,
          manualRequired: true,
          proLicenseRequired: true,
          beforeMeasurementKeys,
          instruction: 'REW rejected API measurement start because a Pro license is required. Start the prepared measurement manually, then resume.'
        };
      }
      throw error;
    }
  }

  async waitForNewMeasurement({ beforeMeasurementKeys, timeoutMs = 90000 }) {
    const before = new Set(beforeMeasurementKeys || []);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = asEntries(await this.listMeasurements());
      const fresh = current.filter(([id, value]) => !before.has(value?.uuid || id));
      if (fresh.length === 1) return { id: fresh[0][0], summary: fresh[0][1] };
      if (fresh.length > 1) throw new Error(`expected one new REW measurement, found ${fresh.length}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('REW measurement did not appear before timeout');
  }

  async captureNewMeasurement({ beforeMeasurementKeys }) {
    const before = new Set(beforeMeasurementKeys || []);
    const current = asEntries(await this.listMeasurements());
    const fresh = current.filter(([id, value]) => !before.has(value?.uuid || id));
    if (fresh.length !== 1) {
      throw new CapabilityError(`expected exactly one new REW measurement, found ${fresh.length}`, {
        before: [...before],
        currentCount: current.length
      });
    }
    return { id: fresh[0][0], summary: fresh[0][1] };
  }

  async trace(id, kind = 'frequency-response') {
    return this.evoburrow.call('rew_trace', { id: String(id), kind, ppo: 96, smoothing: '1/12', maxPoints: 2000 });
  }

  async crossoverAnalysis({ mainId, subId, crossoverHz }) {
    return this.evoburrow.call('rew_crossover_analysis', { mainId: String(mainId), subId: String(subId), crossoverHz, spanOctaves: 1, ppo: 96 });
  }

  async multiseatAnalysis(ids, lowHz = 20, highHz = 300) {
    return this.evoburrow.call('rew_multiseat_analysis', { ids: ids.map(String), lowHz, highHz });
  }

  async saveAll(path, note = 'Dynamic Denon tuning raw measurements') {
    if (!path) throw new Error('path is required');
    const response = await this.request('/measurements/command', {
      method: 'POST',
      body: { command: 'Save all', parameters: [path, note] },
      timeoutMs: 120000
    });
    return { saved: true, path, response };
  }
}
