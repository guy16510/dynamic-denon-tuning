import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMatchedCoverage, deriveMeasuredScore, finalizeMeasuredComparison } from '../src/calibration/verification.js';
import { renderVerificationReport } from '../src/calibration/report.js';

function trace(rough = 0) {
  const frequency = [];
  const magnitude = [];
  for (let f = 20; f <= 20000; f *= 1.035) {
    frequency.push(f);
    magnitude.push(rough * Math.sin(Math.log(f) * 7));
  }
  return { data: { frequency, magnitude, phase: magnitude.map(() => 0) } };
}

function distortion(value = 1) {
  return { data: { columnHeaders: ['Frequency', 'THD (%)'], data: [[100, value], [500, value], [1000, value], [5000, value]] } };
}

function record(position, channel, { rough = 2, time = 0, thd = 2, preset = 1, valid = true } = {}) {
  return {
    position,
    channel,
    measurementType: 'post-calibration-verification',
    preset,
    rewId: `${preset}-${position}-${channel}`,
    acceptedForOptimization: true,
    atmos: { verified: true },
    measurementSettings: {
      command: 'SPL',
      playbackMode: 'From file',
      measurementMode: 'Single',
      stimulus: `/stimuli/${channel}.wav`
    },
    quality: { valid, issues: valid ? [] : ['bad trace'] },
    summary: { timeOfIRPeakSeconds: time },
    traces: {
      frequencyResponse: trace(rough),
      impulseResponse: { data: { peakTimeSeconds: time } },
      distortion: distortion(thd)
    }
  };
}

function dataset(preset, { rough = 2, thd = 2, timingSpread = 0.0005 } = {}) {
  const rows = [];
  for (const position of [0, 1]) {
    rows.push(record(position, 'FL', { rough, thd, preset, time: 0.010 }));
    rows.push(record(position, 'FR', { rough, thd, preset, time: 0.010 + timingSpread }));
    rows.push(record(position, 'C', { rough, thd, preset, time: 0.010 + timingSpread / 2 }));
  }
  return rows;
}

test('matched coverage passes for identical accepted evidence', () => {
  const result = validateMatchedCoverage(dataset(1), dataset(2));
  assert.equal(result.valid, true);
  assert.equal(result.baselineCount, result.candidateCount);
});

test('missing channel rejects comparison with useful diff', () => {
  const candidate = dataset(2).filter(row => !(row.position === 1 && row.channel === 'C'));
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.missingFromCandidate.some(key => key.includes('1|C|')));
});

test('missing position rejects comparison', () => {
  const candidate = dataset(2).filter(row => row.position === 0);
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.missingFromCandidate.some(key => key.startsWith('1|')));
});

test('invalid trace rejects comparison', () => {
  const candidate = dataset(2);
  candidate[0].quality = { valid: false, issues: ['frequency response has fewer than 100 finite magnitude points'] };
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'invalid_trace'));
});

test('missing quality evidence rejects comparison', () => {
  const candidate = dataset(2);
  delete candidate[0].quality;
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'invalid_trace' && issue.issues.some(value => /quality evidence/.test(value))));
});

test('failed Atmos evidence rejects comparison', () => {
  const candidate = dataset(2);
  candidate[0].atmos.verified = false;
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'atmos_unverified'));
});

test('missing Atmos evidence rejects comparison', () => {
  const candidate = dataset(2);
  delete candidate[0].atmos;
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'atmos_unverified' && issue.actual === null));
});

test('missing immutable preset identity rejects comparison', () => {
  const candidate = dataset(2);
  delete candidate[0].preset;
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'preset_mismatch' && issue.actualPreset === null));
});

test('missing negotiated REW settings rejects comparison', () => {
  const candidate = dataset(2);
  delete candidate[0].measurementSettings;
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'invalid_trace' && issue.issues.some(value => /measurement settings/.test(value))));
});

test('different negotiated REW settings reject otherwise matched coverage', () => {
  const candidate = dataset(2);
  candidate[0].measurementSettings.measurementMode = 'Repeated';
  const result = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(result.valid, false);
  const mismatch = result.issues.find(issue => issue.type === 'measurement_settings_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.baseline.measurementMode, 'Single');
  assert.equal(mismatch.candidate.measurementMode, 'Repeated');
});

test('missing metric prevents high-confidence acceptance', () => {
  const rows = dataset(1).map(row => ({ ...row, traces: { ...row.traces, distortion: { unavailable: 'not captured' } } }));
  const result = deriveMeasuredScore(rows);
  assert.ok(result.missing.includes('headroom'));
  assert.notEqual(result.confidence, 'high');
});

test('candidate measured improvement is accepted and recommends Preset 2', () => {
  const result = finalizeMeasuredComparison(
    dataset(1, { rough: 5, thd: 6, timingSpread: 0.0015 }),
    dataset(2, { rough: 1, thd: 1, timingSpread: 0.0002 }),
    { minimumGain: 0.1, majorRegression: 8 }
  );
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.recommendedPreset, 2);
});

test('major regression is rejected and recommends Preset 1', () => {
  const baseline = dataset(1, { rough: 1, thd: 1, timingSpread: 0.0002 });
  const candidate = dataset(2, { rough: 1, thd: 10, timingSpread: 0.0002 });
  const result = finalizeMeasuredComparison(baseline, candidate, { minimumGain: 0, majorRegression: 8 });
  assert.equal(result.accepted, false);
  assert.equal(result.status, 'regression_rejected');
  assert.equal(result.recommendedPreset, 1);
});

test('report contains raw measured statistics and preset recommendation', () => {
  const result = finalizeMeasuredComparison(
    dataset(1, { rough: 5, thd: 6, timingSpread: 0.0015 }),
    dataset(2, { rough: 1, thd: 1, timingSpread: 0.0002 }),
    { minimumGain: 0.1 }
  );
  const state = { channels: ['FL', 'FR', 'C'], completed: [{ position: 0 }, { position: 1 }], rejectedAttempts: [] };
  const report = renderVerificationReport({ receiver: 'Denon AVR-X3700H', baselineSessionId: 'b', candidateSessionId: 'c', baselineState: state, candidateState: state, result });
  assert.match(report, /Raw measured evidence/);
  assert.match(report, /median detrended response RMS/);
  assert.match(report, /Recommended preset: 2/);
  assert.match(report, /THD proxy/);
});
