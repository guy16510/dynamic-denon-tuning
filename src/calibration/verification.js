import { DEFAULT_WEIGHTS, scoreCalibration } from './score.js';
import { compareScores } from './compare.js';
import { deriveCalibrationMetrics } from './derive-metrics.js';
import { validateMeasurementRecord } from '../safety/validation.js';

const UNITS = Object.freeze({
  bassIntegration: 'dB',
  crossoverIntegration: 'dB',
  timing: 'ms',
  frequencyResponse: 'dB',
  channelConsistency: 'dB',
  seatConsistency: 'dB',
  headroom: '% THD proxy'
});

function identity(record) {
  return `${record.position}|${String(record.channel).toUpperCase()}|${record.measurementType || 'verification'}`;
}

function topologySignature(records) {
  return [...new Set(records.map(record => String(record.channel).toUpperCase()))].sort();
}

function evidenceValue(name, evidence) {
  const row = evidence?.[name] || {};
  for (const [key, value] of Object.entries(row)) {
    if (/^value/i.test(key) && Number.isFinite(value)) return value;
  }
  return null;
}

function relevant(records, name) {
  const channels = [...new Set(records.map(record => String(record.channel).toUpperCase()))].sort();
  const positions = [...new Set(records.map(record => record.position))].sort((a, b) => a - b);
  if (name === 'channelConsistency') {
    return { channels: channels.filter(channel => !/^(?:SW|SUB)/i.test(channel)), positions };
  }
  if (name === 'headroom') {
    return { channels: channels.filter(channel => !/^(?:SW|SUB)/i.test(channel)), positions };
  }
  return { channels, positions };
}

export function validateVerificationDataset(records, { expectedPreset = null } = {}) {
  const issues = [];
  const accepted = (records || []).filter(record => record.acceptedForOptimization === true);
  const duplicate = new Set();
  const seen = new Set();
  for (const record of accepted) {
    const gate = validateMeasurementRecord(record);
    if (!gate.valid) issues.push({ type: 'invalid_trace', key: identity(record), issues: gate.issues });
    if (record.atmos?.verified === false) issues.push({ type: 'atmos_failed', key: identity(record) });
    if (expectedPreset != null && record.preset != null && record.preset !== expectedPreset) {
      issues.push({ type: 'preset_mismatch', key: identity(record), expectedPreset, actualPreset: record.preset });
    }
    const key = identity(record);
    if (seen.has(key)) duplicate.add(key);
    seen.add(key);
  }
  for (const key of duplicate) issues.push({ type: 'duplicate_accepted_coverage', key });
  return {
    valid: issues.length === 0 && accepted.length > 0,
    issues,
    accepted,
    topology: topologySignature(accepted)
  };
}

export function validateMatchedCoverage(baselineRecords, candidateRecords, options = {}) {
  const baseline = validateVerificationDataset(baselineRecords, { expectedPreset: options.baselinePreset ?? 1 });
  const candidate = validateVerificationDataset(candidateRecords, { expectedPreset: options.candidatePreset ?? 2 });
  const missingFromBaseline = [];
  const missingFromCandidate = [];
  const bKeys = new Set(baseline.accepted.map(identity));
  const cKeys = new Set(candidate.accepted.map(identity));
  for (const key of cKeys) if (!bKeys.has(key)) missingFromBaseline.push(key);
  for (const key of bKeys) if (!cKeys.has(key)) missingFromCandidate.push(key);
  const topologyMismatch = JSON.stringify(baseline.topology) !== JSON.stringify(candidate.topology);
  const issues = [
    ...baseline.issues.map(issue => ({ side: 'baseline', ...issue })),
    ...candidate.issues.map(issue => ({ side: 'candidate', ...issue }))
  ];
  if (missingFromBaseline.length) issues.push({ type: 'coverage_missing', side: 'baseline', keys: missingFromBaseline });
  if (missingFromCandidate.length) issues.push({ type: 'coverage_missing', side: 'candidate', keys: missingFromCandidate });
  if (topologyMismatch) issues.push({ type: 'topology_mismatch', baseline: baseline.topology, candidate: candidate.topology });
  return {
    valid: baseline.valid && candidate.valid && issues.length === 0,
    baselineCount: baseline.accepted.length,
    candidateCount: candidate.accepted.length,
    baselineTopology: baseline.topology,
    candidateTopology: candidate.topology,
    missingFromBaseline,
    missingFromCandidate,
    issues
  };
}

export function deriveMeasuredScore(records) {
  const derived = deriveCalibrationMetrics(records);
  const components = {};
  for (const name of Object.keys(DEFAULT_WEIGHTS)) {
    const score = derived.metrics?.[name];
    const raw = derived.evidence?.[name] || null;
    if (!Number.isFinite(score) || !raw) continue;
    components[name] = {
      score,
      rawStatistic: raw.statistic || 'derived REW statistic',
      rawValue: evidenceValue(name, derived.evidence),
      units: UNITS[name],
      evidenceSource: 'REW accepted immutable measurement attempts',
      relevant: relevant(records, name),
      assumptions: [raw.caveat].filter(Boolean),
      confidence: 'high',
      evidence: raw
    };
  }
  const numeric = Object.fromEntries(Object.entries(components).map(([name, value]) => [name, value.score]));
  const score = scoreCalibration(numeric);
  const missing = Object.keys(DEFAULT_WEIGHTS).filter(name => !components[name]);
  return {
    derived,
    components,
    score: { ...score, confidence: missing.length === 0 && score.evidenceWeight === 1 ? 'high' : score.confidence },
    missing,
    confidence: missing.length === 0 && score.evidenceWeight === 1 ? 'high' : 'insufficient'
  };
}

export function finalizeMeasuredComparison(baselineRecords, candidateRecords, { minimumGain = 0.5, majorRegression = 8 } = {}) {
  const coverage = validateMatchedCoverage(baselineRecords, candidateRecords);
  const baseline = deriveMeasuredScore(coverage.valid ? baselineRecords : []);
  const candidate = deriveMeasuredScore(coverage.valid ? candidateRecords : []);
  const comparison = compareScores(baseline.score, candidate.score, { minimumGain, majorRegression });
  const gates = [];
  if (!coverage.valid) gates.push('matched coverage failed');
  if (baseline.missing.length) gates.push(`baseline missing metrics: ${baseline.missing.join(', ')}`);
  if (candidate.missing.length) gates.push(`candidate missing metrics: ${candidate.missing.join(', ')}`);
  if (baseline.confidence !== 'high' || candidate.confidence !== 'high') gates.push('high-confidence measured evidence is required');
  if (comparison.regressions.length) gates.push('candidate has a major component regression');
  if (!(comparison.overallDelta >= minimumGain)) gates.push(`candidate aggregate gain is below ${minimumGain}`);
  const accepted = gates.length === 0 && comparison.accepted;
  return {
    accepted,
    status: accepted ? 'complete' : 'regression_rejected',
    recommendedPreset: accepted ? 2 : 1,
    coverage,
    baseline,
    candidate,
    comparison: { ...comparison, accepted },
    gates,
    nextAction: accepted
      ? 'Preset 2 won measured verification and is the recommended preset.'
      : 'Return to Speaker Preset 1. Preset 2 is rejected until a new candidate passes matched measured verification.'
  };
}
