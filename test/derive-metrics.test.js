import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCalibrationMetrics } from '../src/calibration/derive-metrics.js';
import { scoreCalibration } from '../src/calibration/score.js';

function measurement(channel, position, { offsetDb = 0, peakTime = 0.001, roughnessDb = 0.8, thdPercent = 0.8 } = {}) {
  const frequency = [];
  const magnitude = [];
  for (let index = 0; index < 120; index += 1) {
    const hz = 20 * 2 ** (index / 12);
    frequency.push(hz);
    magnitude.push(
      75
      - 1.5 * Math.log2(hz / 1000)
      + Math.sin(index / 8) * roughnessDb
      + offsetDb
    );
  }
  return {
    channel,
    position,
    acceptedForOptimization: true,
    summary: { timeOfIRPeakSeconds: peakTime },
    traces: {
      frequencyResponse: { data: { frequency, magnitude } },
      distortion: {
        data: {
          headers: ['Frequency', 'THD'],
          data: [[100, thdPercent * 0.8], [1000, thdPercent], [5000, thdPercent * 1.1]]
        }
      }
    }
  };
}

function theaterRecords({ roughnessDb = 0.8, timingSpreadMs = 0.15, thdPercent = 0.8 } = {}) {
  const records = [];
  for (let position = 0; position < 3; position += 1) {
    const base = 0.001 + position * 0.00001;
    records.push(
      measurement('FL', position, { peakTime: base, roughnessDb, thdPercent }),
      measurement('FR', position, { offsetDb: 0.2, peakTime: base + timingSpreadMs / 1000, roughnessDb, thdPercent }),
      measurement('SL', position, { offsetDb: -0.1, peakTime: base + 0.25 * timingSpreadMs / 1000, roughnessDb, thdPercent }),
      measurement('SR', position, { offsetDb: 0.1, peakTime: base + 0.75 * timingSpreadMs / 1000, roughnessDb, thdPercent })
    );
  }
  return records;
}

test('derived metrics expose all seven scores and their raw evidence statistics', () => {
  const derived = deriveCalibrationMetrics(theaterRecords());
  assert.deepEqual(Object.keys(derived.metrics).sort(), [
    'bassIntegration',
    'channelConsistency',
    'crossoverIntegration',
    'frequencyResponse',
    'headroom',
    'seatConsistency',
    'timing'
  ]);
  assert.ok(Number.isFinite(derived.evidence.timing.valueMs));
  assert.ok(Number.isFinite(derived.evidence.frequencyResponse.valueDb));
  assert.ok(Number.isFinite(derived.evidence.headroom.valuePercent));
  assert.equal(scoreCalibration(derived.metrics).evidenceWeight, 1);
});

test('worse measured roughness, timing and distortion lower the aggregate score', () => {
  const good = scoreCalibration(deriveCalibrationMetrics(theaterRecords()).metrics);
  const bad = scoreCalibration(deriveCalibrationMetrics(theaterRecords({
    roughnessDb: 7,
    timingSpreadMs: 3,
    thdPercent: 9
  })).metrics);
  assert.ok(bad.score < good.score);
  assert.ok(bad.components.find(component => component.name === 'timing').score < good.components.find(component => component.name === 'timing').score);
  assert.ok(bad.components.find(component => component.name === 'headroom').score < good.components.find(component => component.name === 'headroom').score);
});

test('headroom remains missing when distortion evidence is unavailable', () => {
  const records = theaterRecords();
  for (const record of records) record.traces.distortion = { unavailable: 'not provided' };
  const derived = deriveCalibrationMetrics(records);
  assert.equal(derived.metrics.headroom, undefined);
  assert.ok(derived.caveats.some(value => /headroom was not scored/i.test(value)));
});

test('non-finite magnitude removal preserves its frequency pairing', () => {
  const withGap = theaterRecords();
  const pairedRemoval = structuredClone(withGap);
  const index = 40;
  withGap[0].traces.frequencyResponse.data.magnitude[index] = Number.NaN;
  pairedRemoval[0].traces.frequencyResponse.data.frequency.splice(index, 1);
  pairedRemoval[0].traces.frequencyResponse.data.magnitude.splice(index, 1);

  const fromGap = deriveCalibrationMetrics(withGap);
  const fromPairedRemoval = deriveCalibrationMetrics(pairedRemoval);
  assert.equal(fromGap.evidence.frequencyResponse.valueDb, fromPairedRemoval.evidence.frequencyResponse.valueDb);
  assert.equal(fromGap.evidence.bassIntegration.valueDb, fromPairedRemoval.evidence.bassIntegration.valueDb);
  assert.equal(fromGap.evidence.crossoverIntegration.valueDb, fromPairedRemoval.evidence.crossoverIntegration.valueDb);
});

test('records not affirmatively accepted are excluded from metric extraction', () => {
  const baseline = theaterRecords();
  const expected = deriveCalibrationMetrics(baseline);
  const rogue = measurement('C', 0, { roughnessDb: 50, thdPercent: 50 });
  delete rogue.acceptedForOptimization;
  const actual = deriveCalibrationMetrics([...baseline, rogue]);
  assert.deepEqual(actual.metrics, expected.metrics);
  assert.equal(actual.acceptedRecordCount, expected.acceptedRecordCount);
});
