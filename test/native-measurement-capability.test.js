import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCorrectionExperiment, evaluateNativeMeasurementCapability } from '../src/measurement/native-measurement-capability.js';

test('native capture stays pre-correction-only when controlled MultEQ OFF/ON evidence is effectively identical', () => {
  const result = evaluateNativeMeasurementCapability({
    normalPlaybackCapture: true,
    correctionExperiment: { multEqOff: [0, 1, 0, -1], multEqOn: [0, 1, 0, -1], sameMicPosition: true, sameSpeaker: true, sameStimulus: true, expectedCorrectionMaterial: true }
  });
  assert.equal(result.state, 'pre-correction-only');
  assert.equal(result.usableForPhysicalVerification, false);
});

test('post-correction capability requires changed response plus independently verified preset and capture path', () => {
  const experiment = { multEqOff: [0, 1, 0, -1], multEqOn: [0, 0.5, 0, -0.5], sameMicPosition: true, sameSpeaker: true, sameStimulus: true, expectedCorrectionMaterial: true };
  assert.equal(compareCorrectionExperiment(experiment).changed, true);
  assert.equal(evaluateNativeMeasurementCapability({ normalPlaybackCapture: true, correctionExperiment: experiment }).state, 'unknown');
  assert.equal(evaluateNativeMeasurementCapability({ normalPlaybackCapture: true, correctionExperiment: experiment, activePresetVerified: true, capturePathVerified: true }).state, 'post-correction-capable');
});
