const CAPABILITY_KEYS = Object.freeze([
  'impulseResponse', 'frequencyResponse', 'phase', 'timing', 'absoluteSpl',
  'distortion', 'compression', 'postCorrection', 'activePresetVerified'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function normalizeCapabilities(input = {}) {
  return Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map(key => [key, input[key] === true])));
}

export function createMeasurement(input) {
  if (!input?.id) throw new Error('measurement id is required');
  if (!input?.source) throw new Error('measurement source is required');
  if (!input?.channel) throw new Error('measurement channel is required');
  if (!Number.isFinite(Number(input.sampleRateHz)) || Number(input.sampleRateHz) <= 0) throw new Error('measurement sampleRateHz must be positive');
  const model = {
    id: String(input.id),
    source: String(input.source),
    sourceEvidence: input.sourceEvidence || null,
    sessionId: input.sessionId || null,
    channel: String(input.channel).toUpperCase(),
    position: input.position ?? 0,
    sampleRateHz: Number(input.sampleRateHz),
    impulseResponse: input.impulseResponse || null,
    frequencyResponse: input.frequencyResponse || null,
    phase: input.phase || null,
    groupDelay: input.groupDelay || null,
    distortion: input.distortion || null,
    absoluteLevelDb: input.absoluteLevelDb ?? null,
    arrivalTimeMs: input.arrivalTimeMs ?? null,
    receiverState: input.receiverState || null,
    preset: input.preset ?? null,
    capabilities: normalizeCapabilities(input.capabilities),
    capturedAt: input.capturedAt || null,
    hashes: input.hashes || {}
  };
  return deepFreeze(model);
}

export function requireCapabilities(measurementOrCapabilities, required) {
  const capabilities = measurementOrCapabilities?.capabilities || measurementOrCapabilities || {};
  const missing = required.filter(name => capabilities[name] !== true);
  return { available: missing.length === 0, missing };
}
