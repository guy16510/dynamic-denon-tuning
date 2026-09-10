import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { CapabilityError } from '../lib/errors.js';

function unwrapScalar(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    for (const key of ['value', 'message', 'name']) {
      if (typeof value[key] === 'string' || typeof value[key] === 'number' || typeof value[key] === 'boolean') return value[key];
    }
  }
  return value;
}

export function normalizeChoices(value) {
  const unwrapped = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? (value.choices ?? value.values ?? value.options ?? value) : value);
  if (!Array.isArray(unwrapped)) return [];
  return unwrapped
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.value ?? item.name ?? item.label ?? item.message ?? null;
      return item == null ? null : String(item);
    })
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim());
}

export function selectChoice(choices, matchers) {
  for (const matcher of matchers) {
    const found = choices.find(choice => matcher.test(choice));
    if (found) return found;
  }
  return null;
}

export function decodeFloat32Base64(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== 'string' || !value.trim()) return [];
  const bytes = Buffer.from(value.trim(), 'base64');
  if (!bytes.length || bytes.length % 4 !== 0) return [];
  const out = new Array(bytes.length / 4);
  for (let offset = 0, index = 0; offset < bytes.length; offset += 4, index += 1) {
    out[index] = bytes.readFloatBE(offset);
  }
  return out;
}

function sampleIndices(length, maxPoints, include = []) {
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil(length / maxPoints);
  const indices = [];
  for (let index = 0; index < length; index += step) indices.push(index);
  indices.push(length - 1, ...include.filter(index => Number.isInteger(index) && index >= 0 && index < length));
  return [...new Set(indices)].sort((a, b) => a - b);
}

function pick(values, indices) {
  return indices.map(index => values[index]).filter(value => value !== undefined);
}

function frequencyAxis(data, length) {
  const startFreq = Number(data?.startFreq ?? data?.startFrequency);
  const ppo = Number(data?.ppo ?? data?.pointsPerOctave);
  const freqStep = Number(data?.freqStep ?? data?.frequencyStep);
  if (!Number.isFinite(startFreq) || startFreq <= 0) return [];
  if (Number.isFinite(ppo) && ppo > 0) {
    return Array.from({ length }, (_, index) => startFreq * 2 ** (index / ppo));
  }
  if (Number.isFinite(freqStep) && freqStep > 0) {
    return Array.from({ length }, (_, index) => startFreq + index * freqStep);
  }
  return [];
}

export function decodeRewTrace(kind, payload, { maxPoints = 4000 } = {}) {
  const outer = payload && typeof payload === 'object' ? payload : { data: payload };
  const source = outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data) ? outer.data : outer;

  if (kind === 'frequency-response' || kind === 'group-delay') {
    const magnitude = decodeFloat32Base64(source.magnitude ?? source.magnitudes);
    const phase = decodeFloat32Base64(source.phase ?? source.phases);
    const length = magnitude.length || phase.length;
    if (!length) return payload;
    const frequency = frequencyAxis(source, length);
    const indices = sampleIndices(length, maxPoints);
    return {
      ...outer,
      data: {
        ...source,
        magnitude: pick(magnitude, indices),
        ...(phase.length ? { phase: pick(phase, indices) } : {}),
        ...(frequency.length ? { frequency: pick(frequency, indices) } : {}),
        decodedFromBase64: typeof (source.magnitude ?? source.magnitudes) === 'string',
        originalPoints: length
      }
    };
  }

  if (kind === 'impulse-response') {
    const values = decodeFloat32Base64(source.data ?? source.response ?? source.values);
    if (!values.length) return payload;
    let peakIndex = 0;
    for (let index = 1; index < values.length; index += 1) {
      if (Math.abs(values[index]) > Math.abs(values[peakIndex])) peakIndex = index;
    }
    const startTime = Number(source.startTime ?? source.startTimeSeconds ?? 0);
    const sampleInterval = Number(source.sampleInterval ?? source.sampleIntervalSeconds ?? (Number(source.sampleRate) > 0 ? 1 / Number(source.sampleRate) : NaN));
    const indices = sampleIndices(values.length, maxPoints, [peakIndex]);
    return {
      ...outer,
      data: {
        ...source,
        data: pick(values, indices),
        sampleIndices: indices,
        peakIndex,
        peakValue: values[peakIndex],
        peakTimeSeconds: Number.isFinite(sampleInterval) ? startTime + peakIndex * sampleInterval : null,
        decodedFromBase64: typeof (source.data ?? source.response ?? source.values) === 'string',
        originalSamples: values.length
      }
    };
  }

  return payload;
}

function asEntries(measurements) {
  if (Array.isArray(measurements)) return measurements.map((value, index) => [String(index + 1), value]);
  return Object.entries(measurements || {});
}

function measurementKey(id, value) {
  return String(value?.uuid || id);
}

async function waitForNonEmptyFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const file = await stat(path);
      if (file.isFile() && file.size > 0) return { size: file.size, mtimeMs: file.mtimeMs };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`REW archive did not appear as a non-empty file within ${timeoutMs} ms: ${path}`);
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

  async measurementContract() {
    const [commandResponse, playbackResponse, measurementResponse] = await Promise.all([
      this.request('/measure/commands'),
      this.request('/measure/playback-mode/choices'),
      this.request('/measure/measurement-mode/choices')
    ]);
    const commands = normalizeChoices(commandResponse);
    const playbackModes = normalizeChoices(playbackResponse);
    const measurementModes = normalizeChoices(measurementResponse);
    const selected = {
      command: selectChoice(commands, [/^SPL$/i]),
      playbackMode: selectChoice(playbackModes, [/^from\s+file$/i, /file/i]),
      measurementMode: selectChoice(measurementModes, [/^single$/i, /^single\b/i])
    };
    const blockers = [];
    if (!selected.command) blockers.push('REW does not advertise the SPL measurement command.');
    if (!selected.playbackMode) blockers.push('REW does not advertise a file playback mode.');
    if (!selected.measurementMode) blockers.push('REW does not advertise a single-measurement mode.');
    return {
      valid: blockers.length === 0,
      commands,
      playbackModes,
      measurementModes,
      selected,
      blockers
    };
  }

  async status() {
    const [probe, audio, version, commands, playbackMode, measurementMode, contract] = await Promise.all([
      this.evoburrow.call('rew_probe', {}).catch(error => ({ unavailable: error.message })),
      this.evoburrow.call('rew_audio_inventory', {}).catch(error => ({ unavailable: error.message })),
      this.request('/version').catch(error => ({ unavailable: error.message })),
      this.request('/measure/commands').catch(error => ({ unavailable: error.message })),
      this.request('/measure/playback-mode').then(unwrapScalar).catch(error => ({ unavailable: error.message })),
      this.request('/measure/measurement-mode').then(unwrapScalar).catch(error => ({ unavailable: error.message })),
      this.measurementContract().catch(error => ({ valid: false, unavailable: error.message }))
    ]);
    return { url: this.config.url, probe, audio, version, commands, playbackMode, measurementMode, contract };
  }

  async detectAutoMeasureCapability() {
    if (this.config.measurementMode === 'manual') {
      return { automated: false, mode: 'manual', reason: 'REW_MEASUREMENT_MODE=manual' };
    }
    const contract = await this.measurementContract();
    if (!contract.valid) {
      return { automated: false, mode: this.config.measurementMode, reason: contract.blockers.join(' '), contract };
    }
    return {
      automated: this.config.measurementMode === 'pro',
      mode: this.config.measurementMode,
      probeOnly: this.config.measurementMode === 'auto',
      command: contract.selected.command,
      contract,
      note: 'REW requires a Pro upgrade to trigger automated sweep measurements through the API. In auto mode the license is confirmed only when an actual measurement is attempted.'
    };
  }

  async inputLevelCheck({ durationMs = 4000, confirm = false } = {}) {
    return this.evoburrow.call('rew_input_level_check', { durationMs, confirm });
  }

  async configureFilePlayback({ stimulusPath }) {
    if (!stimulusPath) throw new Error('stimulusPath is required');
    const contract = await this.measurementContract();
    if (!contract.valid) {
      throw new CapabilityError('Installed REW does not expose the required Measure From File contract', contract);
    }

    await this.request('/measure/file-playback-stimulus', { method: 'POST', body: stimulusPath });
    await this.request('/measure/playback-mode', { method: 'POST', body: contract.selected.playbackMode });
    await this.request('/measure/measurement-mode', { method: 'POST', body: contract.selected.measurementMode });

    const [stimulus, actualPlayback, actualMeasurement] = await Promise.all([
      this.request('/measure/file-playback-stimulus').then(unwrapScalar),
      this.request('/measure/playback-mode').then(unwrapScalar),
      this.request('/measure/measurement-mode').then(unwrapScalar)
    ]);
    const verified = String(actualPlayback).toLowerCase() === String(contract.selected.playbackMode).toLowerCase()
      && String(actualMeasurement).toLowerCase() === String(contract.selected.measurementMode).toLowerCase();
    if (!verified) {
      throw new CapabilityError('REW did not retain the requested Measure From File configuration', {
        expected: contract.selected,
        actual: { stimulus, playbackMode: actualPlayback, measurementMode: actualMeasurement }
      });
    }
    return {
      configured: true,
      verified,
      stimulus,
      playbackMode: actualPlayback,
      measurementMode: actualMeasurement,
      contract
    };
  }

  async listMeasurements() {
    return this.request('/measurements');
  }

  async measurementKeys() {
    return asEntries(await this.listMeasurements()).map(([id, value]) => measurementKey(id, value));
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

    const contract = await this.measurementContract();
    if (!contract.valid) throw new CapabilityError('REW measurement contract is incomplete', contract);

    try {
      await this.request('/measure/command', {
        method: 'POST',
        body: { command: contract.selected.command },
        timeoutMs: 10000
      });
      return { started: true, manualRequired: false, beforeMeasurementKeys, command: contract.selected.command };
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
      const fresh = current.filter(([id, value]) => !before.has(measurementKey(id, value)));
      if (fresh.length === 1) {
        const [id, summary] = fresh[0];
        return { id: measurementKey(id, summary), summary };
      }
      if (fresh.length > 1) throw new Error(`expected one new REW measurement, found ${fresh.length}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('REW measurement did not appear before timeout');
  }

  async captureNewMeasurement({ beforeMeasurementKeys }) {
    const before = new Set(beforeMeasurementKeys || []);
    const current = asEntries(await this.listMeasurements());
    const fresh = current.filter(([id, value]) => !before.has(measurementKey(id, value)));
    if (fresh.length !== 1) {
      throw new CapabilityError(`expected exactly one new REW measurement, found ${fresh.length}`, {
        before: [...before],
        currentCount: current.length
      });
    }
    const [id, summary] = fresh[0];
    return { id: measurementKey(id, summary), summary };
  }

  async trace(id, kind = 'frequency-response') {
    const raw = await this.evoburrow.call('rew_trace', { id: String(id), kind, ppo: 96, smoothing: '1/12', maxPoints: 2000 });
    return decodeRewTrace(kind, raw, { maxPoints: kind === 'impulse-response' ? 4000 : 2500 });
  }

  async crossoverAnalysis({ mainId, subId, crossoverHz }) {
    return this.evoburrow.call('rew_crossover_analysis', { mainId: String(mainId), subId: String(subId), crossoverHz, spanOctaves: 1, ppo: 96 });
  }

  async multiseatAnalysis(ids, lowHz = 20, highHz = 300) {
    return this.evoburrow.call('rew_multiseat_analysis', { ids: ids.map(String), lowHz, highHz });
  }

  async saveAll(path, note = 'Dynamic Denon tuning raw measurements', { verifyTimeoutMs = 120000 } = {}) {
    if (!path) throw new Error('path is required');
    try {
      await access(path, constants.F_OK);
      throw new Error(`refusing to let REW overwrite an existing archive: ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const response = await this.request('/measurements/command', {
      method: 'POST',
      body: { command: 'Save all', parameters: [path, note] },
      timeoutMs: 120000
    });
    const file = await waitForNonEmptyFile(path, verifyTimeoutMs);
    return {
      saved: true,
      verified: true,
      path,
      size: file.size,
      mtimeMs: file.mtimeMs,
      response,
      rule: 'REW command acceptance is not considered archive success until the requested local .mdat exists and is non-empty.'
    };
  }
}
