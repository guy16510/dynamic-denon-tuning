import { createHash } from 'node:crypto';
import { createMeasurement } from './measurement-model.js';

function responseHash(samples) {
  return createHash('sha256').update(JSON.stringify(samples)).digest('hex');
}

function peakArrivalMs(samples, sampleRateHz) {
  let index = 0;
  let peak = -1;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) { peak = magnitude; index = i; }
  }
  return (index / sampleRateHz) * 1000;
}

export function measurementsFromAudyssey(parsed, { sessionId = null } = {}) {
  if (!parsed?.channels || !parsed?.metadata) throw new Error('parsed Audyssey evidence is required');
  const output = [];
  for (const channel of parsed.channels) {
    for (const response of channel.responses) {
      const id = `ady:${parsed.metadata.sourceSha256}:${channel.id}:P${response.position}`;
      output.push(createMeasurement({
        id,
        source: 'audyssey-ady',
        sourceEvidence: {
          sourceFilename: parsed.metadata.sourceFilename,
          sourceSha256: parsed.metadata.sourceSha256,
          receiverModel: parsed.metadata.receiverModel,
          multEqType: parsed.metadata.multEqType,
          sampleRateSource: parsed.metadata.sampleRateSource,
          sourceChannelIndex: channel.sourceIndex
        },
        sessionId,
        channel: channel.id,
        position: response.position,
        sampleRateHz: parsed.metadata.sampleRateHz,
        impulseResponse: response.samples,
        arrivalTimeMs: peakArrivalMs(response.samples, parsed.metadata.sampleRateHz),
        receiverState: {
          customDistance: channel.customDistance,
          customTrim: channel.customTrim,
          customCrossover: channel.customCrossover,
          audysseySettings: channel.audysseySettings
        },
        capabilities: {
          impulseResponse: true,
          timing: true,
          frequencyResponse: false,
          phase: false,
          absoluteSpl: false,
          distortion: false,
          compression: false,
          postCorrection: false,
          activePresetVerified: false
        },
        hashes: { impulseSha256: responseHash(response.samples), sourceSha256: parsed.metadata.sourceSha256 }
      }));
    }
  }
  return output;
}
