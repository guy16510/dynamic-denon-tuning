import { RewAdapter } from './rew.js';

export function encodeFloat32Base64(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('impulse samples are required');
  const buffer = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => {
    const sample = Number(value);
    if (!Number.isFinite(sample)) throw new Error(`impulse sample ${index} must be finite`);
    buffer.writeFloatBE(sample, index * 4);
  });
  return buffer.toString('base64');
}

export class RewV2Adapter extends RewAdapter {
  async importImpulseResponseFile({ path, channels = 'All', timeoutMs = 90000 }) {
    if (!path) throw new Error('impulse response path is required');
    const beforeMeasurementKeys = await this.measurementKeys();
    const response = await this.request('/import/impulse-response', {
      method: 'POST',
      body: { path, channels },
      timeoutMs: 15000
    });
    const measurement = await this.waitForNewMeasurement({ beforeMeasurementKeys, timeoutMs });
    return {
      imported: true,
      source: 'file',
      path,
      channels,
      response,
      measurement,
      endpoint: '/import/impulse-response'
    };
  }

  async importImpulseResponseData({ identifier, samples, sampleRateHz, startTime = 0, splOffset = 0, applyCal = false, timeoutMs = 90000 }) {
    if (!identifier || !String(identifier).trim()) throw new Error('identifier is required');
    const sampleRate = Number(sampleRateHz);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('sampleRateHz must be positive');
    if (!Number.isFinite(Number(startTime))) throw new Error('startTime must be finite');
    if (!Number.isFinite(Number(splOffset))) throw new Error('splOffset must be finite');
    const beforeMeasurementKeys = await this.measurementKeys();
    const payload = {
      identifier: String(identifier),
      startTime: Number(startTime),
      sampleRate,
      splOffset: Number(splOffset),
      applyCal: applyCal === true,
      data: encodeFloat32Base64(samples)
    };
    const response = await this.request('/import/impulse-response-data', {
      method: 'POST',
      body: payload,
      timeoutMs: 15000
    });
    const measurement = await this.waitForNewMeasurement({ beforeMeasurementKeys, timeoutMs });
    return {
      imported: true,
      source: 'data',
      identifier: payload.identifier,
      sampleRateHz: payload.sampleRate,
      samples: samples.length,
      applyCal: payload.applyCal,
      response,
      measurement,
      endpoint: '/import/impulse-response-data'
    };
  }
}
