import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMatchedCoverage, deriveMeasuredScore, finalizeMeasuredComparison } from '../src/calibration/verification.js';
import { renderVerificationReport } from '../src/calibration/report.js';

function trace(rough = 1) {
  const frequency = [];
  const magnitude = [];
  for (let f = 20; f <= 20000; f *= 1.035) {
    frequency.push(f);
    magnitude.push(rough * Math.sin(Math.log(f) * 7));
  }
  return { data: { frequency, magnitude, phase: magnitude.map(() => 0) } };
}

function record(preset, position, channel, rough = 1) {
  const offset = channel === 'FR' ? 0.0002 : channel === 'C' ? 0.0001 : 0;
  return {
    position,
    channel,
    measurementType: 'post-calibration-verification',
    preset,
    rewId: `${preset}-${position}-${channel}`,
    acceptedForOptimization: true,
    atmos: { verified: true },
    measurementSettings: { command: 'SPL', playbackMode: 'From file', measurementMode: 'Single', stimulus: `/stimuli/${channel}.wav` },
    quality: { valid: true, issues: [] },
    summary: { timeOfIRPeakSeconds: 0.01 + offset },
    traces: {
      frequencyResponse: trace(rough),
      impulseResponse: { data: { peakTimeSeconds: 0.01 + offset } },
      distortion: { data: { columnHeaders: ['Frequency', 'THD (%)'], data: [[100, 1], [1000, 1], [5000, 1]] } }
    }
  };
}

function dataset(preset, rough = 1) {
  return [0, 1].flatMap(position => ['FL', 'FR', 'C'].map(channel => record(preset, position, channel, rough)));
}

test('raw trace is revalidated even if stored quality metadata claims it passed', () => {
  const candidate = dataset(2);
  candidate[0].traces.frequencyResponse.data.frequency[20] = candidate[0].traces.frequencyResponse.data.frequency[19];
  candidate[0].quality = { valid: true, issues: [] };
  const coverage = validateMatchedCoverage(dataset(1), candidate);
  assert.equal(coverage.valid, false);
  assert.ok(coverage.issues.some(issue => issue.type === 'invalid_trace' && issue.issues.some(value => /raw trace: frequency axis is not strictly increasing/.test(value))));
});

test('complete measured score records explicit confidence rationale for every component', () => {
  const measured = deriveMeasuredScore(dataset(1));
  assert.equal(measured.confidence, 'high');
  assert.deepEqual(measured.insufficientConfidence, []);
  for (const component of Object.values(measured.components)) {
    assert.equal(component.confidence, 'high');
    assert.ok(component.confidenceReason.length > 10);
    assert.equal(component.evidenceSource, 'REW accepted immutable measurement attempts');
    assert.ok(component.relevant.channels.length > 0);
    assert.ok(component.relevant.positions.length > 0);
  }
});

test('verification report exposes attempt identities and evidence provenance', () => {
  const result = finalizeMeasuredComparison(dataset(1, 5), dataset(2, 1), { minimumGain: 0 });
  const baselineState = {
    channels: ['FL', 'FR', 'C'],
    completed: [{ position: 0, channel: 'FL', attempt: 1, rewId: 'b-fl', path: 'measurements/position-0/FL/attempt-001-b-fl.json' }],
    rejectedAttempts: [{ position: 0, channel: 'FR', attempt: 1, rewId: 'b-fr-failed', path: 'measurements/position-0/FR/attempt-001-b-fr-failed.json' }]
  };
  const candidateState = {
    channels: ['FL', 'FR', 'C'],
    completed: [{ position: 0, channel: 'FL', attempt: 1, rewId: 'c-fl', path: 'measurements/position-0/FL/attempt-001-c-fl.json' }],
    rejectedAttempts: []
  };
  const report = renderVerificationReport({ receiver: 'Denon AVR-X3700H', baselineSessionId: 'baseline', candidateSessionId: 'candidate', baselineState, candidateState, result });
  assert.match(report, /Measurement attempt history/);
  assert.match(report, /REW b-fr-failed/);
  assert.match(report, /evidence source: REW accepted immutable measurement attempts/i);
  assert.match(report, /confidence basis:/i);
  assert.match(report, /relevant evidence: channels \[/i);
});
