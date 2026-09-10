import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const RootSchema = z.object({}).passthrough();
const KNOWN_RESPONSE_LENGTH = 16384;
const ASSUMED_SAMPLE_RATE_HZ = 48000;

const rootAliases = {
  receiverModel: ['TargetModelName', 'targetModelName', 'ModelName', 'modelName', 'ReceiverModel', 'receiverModel'],
  multEqType: ['MultEQType', 'multEQType', 'MultEqType', 'multEqType'],
  sampleRateHz: ['SampleRate', 'sampleRate', 'SampleRateHz', 'sampleRateHz'],
  detectedChannels: ['DetectedChannels', 'detectedChannels']
};

const channelAliases = {
  channel: ['ChannelType', 'channelType', 'Channel', 'channel', 'CommandID', 'commandId'],
  responseData: ['ResponseData', 'responseData'],
  customDistance: ['CustomDistance', 'customDistance', 'Distance', 'distance'],
  customTrim: ['CustomLevel', 'customLevel', 'CustomTrim', 'customTrim', 'ChLevel', 'chLevel'],
  customCrossover: ['CustomCrossover', 'customCrossover', 'Crossover', 'crossover'],
  targetCurve: ['TargetCurvePoints', 'targetCurvePoints', 'TargetCurve', 'targetCurve'],
  audysseySettings: ['AudysseySettings', 'audysseySettings']
};

function firstValue(object, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(object || {}, key)) return object[key];
  }
  return undefined;
}

function firstExistingKey(object, aliases) {
  return aliases.find(key => Object.prototype.hasOwnProperty.call(object || {}, key)) || null;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return number;
}

function normalizeSamples(samples, label) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error(`${label} must be a non-empty sample array`);
  return samples.map((value, index) => finiteNumber(value, `${label}[${index}]`));
}

function normalizeResponseEntries(raw, channelId) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`channel ${channelId} is missing ResponseData`);
  if (raw.every(value => typeof value === 'number')) {
    return [{ position: 0, samples: normalizeSamples(raw, `${channelId}.ResponseData`) }];
  }
  return raw.map((entry, index) => {
    if (Array.isArray(entry)) {
      return { position: index, samples: normalizeSamples(entry, `${channelId}.ResponseData[${index}]`) };
    }
    if (!entry || typeof entry !== 'object') throw new Error(`${channelId}.ResponseData[${index}] is malformed`);
    const samples = firstValue(entry, ['ResponseData', 'responseData', 'Samples', 'samples', 'Data', 'data']);
    const positionValue = firstValue(entry, ['Position', 'position', 'MicPosition', 'micPosition', 'Index', 'index']);
    return {
      position: positionValue == null ? index : finiteNumber(positionValue, `${channelId}.position`),
      samples: normalizeSamples(samples, `${channelId}.ResponseData[${index}]`),
      metadata: { ...entry }
    };
  });
}

function normalizeChannel(channel, index) {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) throw new Error(`DetectedChannels[${index}] must be an object`);
  const channelId = firstValue(channel, channelAliases.channel);
  if (channelId == null || String(channelId).trim() === '') throw new Error(`DetectedChannels[${index}] is missing channel identity`);
  const id = String(channelId).trim().toUpperCase();
  const responses = normalizeResponseEntries(firstValue(channel, channelAliases.responseData), id);
  return {
    id,
    sourceIndex: index,
    responses,
    responseLengths: responses.map(item => item.samples.length),
    customDistance: firstValue(channel, channelAliases.customDistance) ?? null,
    customTrim: firstValue(channel, channelAliases.customTrim) ?? null,
    customCrossover: firstValue(channel, channelAliases.customCrossover) ?? null,
    targetCurve: firstValue(channel, channelAliases.targetCurve) ?? null,
    audysseySettings: firstValue(channel, channelAliases.audysseySettings) ?? null,
    raw: channel
  };
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function parseAdyText(text, { sourceFilename = 'unknown.ady', importedAt = new Date().toISOString() } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Audyssey .ady source must be non-empty UTF-8 JSON');
  let raw;
  try { raw = RootSchema.parse(JSON.parse(text)); }
  catch (error) { throw new Error(`invalid Audyssey .ady JSON: ${error.message}`); }

  const detected = firstValue(raw, rootAliases.detectedChannels);
  if (!Array.isArray(detected) || detected.length === 0) throw new Error('Audyssey .ady must contain DetectedChannels/detectedChannels');
  const declaredRate = firstValue(raw, rootAliases.sampleRateHz);
  const sampleRateHz = declaredRate == null ? ASSUMED_SAMPLE_RATE_HZ : finiteNumber(declaredRate, 'sample rate');
  if (sampleRateHz < 8000 || sampleRateHz > 384000) throw new Error(`unsupported Audyssey sample rate: ${sampleRateHz}`);
  const channels = detected.map(normalizeChannel);
  const warnings = [];
  for (const channel of channels) {
    for (const length of channel.responseLengths) {
      if (length !== KNOWN_RESPONSE_LENGTH) warnings.push(`${channel.id} response length ${length} differs from common Audyssey length ${KNOWN_RESPONSE_LENGTH}`);
    }
  }

  return Object.freeze({
    format: 'audyssey-ady-json',
    raw,
    metadata: {
      receiverModel: firstValue(raw, rootAliases.receiverModel) ?? null,
      multEqType: firstValue(raw, rootAliases.multEqType) ?? null,
      sampleRateHz,
      sampleRateSource: declaredRate == null ? 'audyssey-format-assumption' : 'source-declared',
      sourceFilename,
      sourceSha256: digest(text),
      importedAt,
      warnings
    },
    channels
  });
}

export async function parseAdyFile(path) {
  return parseAdyText(await readFile(path, 'utf8'), { sourceFilename: path });
}

export function serializeAdy(parsedOrRaw) {
  const raw = parsedOrRaw?.raw || parsedOrRaw;
  RootSchema.parse(raw);
  return `${JSON.stringify(raw, null, 2)}\n`;
}

const candidateFieldAliases = {
  customDistance: channelAliases.customDistance,
  customTrim: channelAliases.customTrim,
  customCrossover: channelAliases.customCrossover
};
const canonicalFieldNames = {
  customDistance: 'CustomDistance',
  customTrim: 'CustomLevel',
  customCrossover: 'CustomCrossover'
};

export function createAdyCandidate(parsed, changes, { candidateId = 'candidate' } = {}) {
  if (!parsed?.raw || !Array.isArray(changes) || changes.length === 0) throw new Error('parsed .ady and at least one candidate change are required');
  const raw = structuredClone(parsed.raw);
  const channelKey = firstExistingKey(raw, rootAliases.detectedChannels);
  if (!channelKey || !Array.isArray(raw[channelKey])) throw new Error('candidate source has no detected channels');
  const diffs = [];
  for (const change of changes) {
    const requestedChannel = String(change.channel || '').trim().toUpperCase();
    if (!requestedChannel) throw new Error('candidate change requires channel');
    if (!candidateFieldAliases[change.field]) throw new Error(`unsupported Audyssey candidate field: ${change.field}`);
    const channel = raw[channelKey].find(item => String(firstValue(item, channelAliases.channel) || '').trim().toUpperCase() === requestedChannel);
    if (!channel) throw new Error(`Audyssey candidate channel not found: ${requestedChannel}`);
    const key = firstExistingKey(channel, candidateFieldAliases[change.field]) || canonicalFieldNames[change.field];
    const before = channel[key] ?? null;
    const after = finiteNumber(change.value, `${requestedChannel}.${change.field}`);
    channel[key] = after;
    diffs.push({ channel: requestedChannel, field: key, from: before, to: after, reason: change.reason || 'deterministic candidate search', candidateId });
  }
  const text = `${JSON.stringify(raw, null, 2)}\n`;
  return Object.freeze({ candidateId, raw, text, sha256: digest(text), diffs });
}
