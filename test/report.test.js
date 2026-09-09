import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCalibrationReport } from '../src/calibration/report.js';

const baseline = { score: 70, confidence: 'high', components: [] };
const candidate = { score: 91, confidence: 'high', components: [] };

test('report makes measured acceptance and remaining problems explicit', () => {
  const report = renderCalibrationReport({
    baseline,
    candidate,
    comparison: { accepted: true, overallDelta: 21, regressions: [], improvements: [{ name: 'bassIntegration', before: 60, after: 90, delta: 30 }] },
    remainingIssues: ['53 Hz cancellation, physical room issue']
  });
  assert.match(report, /Accepted: yes/);
  assert.match(report, /No acoustic change is considered an improvement until it has been re-measured/);
  assert.match(report, /53 Hz cancellation/);
});
