import { DEFAULT_WEIGHTS } from './score.js';

export const OBJECTIVE_ALGORITHM_VERSION = 'objective-v2.1';

export const METRIC_REQUIREMENTS = Object.freeze({
  bassIntegration: { all: ['frequencyResponse'] },
  crossoverIntegration: { all: ['frequencyResponse'] },
  timing: { all: ['timing'] },
  frequencyResponse: { all: ['frequencyResponse'] },
  channelConsistency: { all: ['frequencyResponse'] },
  seatConsistency: { all: ['frequencyResponse'] },
  headroom: { any: ['distortion', 'compression'] }
});

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function metricCapabilityStatus(capabilities, requirement = {}) {
  const missingAll = (requirement.all || []).filter(name => capabilities?.[name] !== true);
  const any = requirement.any || [];
  const anySatisfied = any.length === 0 || any.some(name => capabilities?.[name] === true);
  return { available: missingAll.length === 0 && anySatisfied, missing: [...missingAll, ...(anySatisfied ? [] : any)] };
}

function componentConfidence(items) {
  if (items.some(item => item.confidence === 'low')) return 'low';
  if (items.some(item => item.confidence === 'medium')) return 'medium';
  return 'high';
}

export function scoreObjectiveV2({ metrics = {}, capabilities = {}, profile, targetProfileHash = null, mode = 'search' }) {
  const weights = profile?.weights || DEFAULT_WEIGHTS;
  const components = [];
  const missingComponents = [];
  let weighted = 0;
  let weightsUsed = 0;
  for (const [name, weightValue] of Object.entries(weights)) {
    const weight = Number(weightValue);
    const requirement = METRIC_REQUIREMENTS[name] || {};
    const capability = metricCapabilityStatus(capabilities, requirement);
    const source = metrics[name];
    const score = bounded(typeof source === 'object' ? source.score : source);
    if (!capability.available || score == null) {
      missingComponents.push({ name, weight, status: 'unavailable', missingCapabilities: capability.missing, reason: score == null ? 'metric not calculated' : 'measurement source cannot prove metric' });
      continue;
    }
    const component = {
      name,
      score,
      weight,
      raw: typeof source === 'object' ? source.raw ?? null : null,
      units: typeof source === 'object' ? source.units ?? null : null,
      confidence: typeof source === 'object' ? source.confidence || 'high' : 'high',
      capabilitiesRequired: requirement,
      explanation: typeof source === 'object' ? source.explanation || null : null
    };
    components.push(component);
    weighted += score * weight;
    weightsUsed += weight;
  }
  const value = weightsUsed > 0 ? Math.round((weighted / weightsUsed) * 1000) / 1000 : null;
  let confidence = components.length ? componentConfidence(components) : 'low';
  if (weightsUsed < 0.6) confidence = 'low';
  else if (weightsUsed < 0.9 && confidence === 'high') confidence = 'medium';
  if (mode === 'verification' && capabilities.postCorrection !== true) confidence = 'low';
  return {
    value,
    components,
    weightsUsed: Math.round(weightsUsed * 1000) / 1000,
    missingComponents,
    capabilities: { ...capabilities },
    confidence,
    targetProfileHash,
    algorithmVersion: OBJECTIVE_ALGORITHM_VERSION,
    mode
  };
}

export function matchedVerificationCapabilities(baseline, candidate) {
  const relevant = new Set([...Object.keys(baseline || {}), ...Object.keys(candidate || {})]);
  const mismatched = [...relevant].filter(key => Boolean(baseline?.[key]) !== Boolean(candidate?.[key])).sort();
  const postCorrection = baseline?.postCorrection === true && candidate?.postCorrection === true;
  return { matched: mismatched.length === 0, mismatched, postCorrection, physicallyVerifiable: mismatched.length === 0 && postCorrection };
}
