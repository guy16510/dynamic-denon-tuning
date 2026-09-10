export const NATIVE_MEASUREMENT_STATES = Object.freeze([
  'unsupported',
  'calibration-only',
  'pre-correction-only',
  'post-correction-capable',
  'unknown'
]);

function rmsDelta(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let deltaEnergy = 0;
  let referenceEnergy = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
    deltaEnergy += (av - bv) ** 2;
    referenceEnergy += av ** 2;
  }
  const delta = Math.sqrt(deltaEnergy / a.length);
  const reference = Math.sqrt(referenceEnergy / a.length);
  return reference > 0 ? delta / reference : delta;
}

export function compareCorrectionExperiment({ multEqOff, multEqOn, sameMicPosition, sameSpeaker, sameStimulus, expectedCorrectionMaterial = true, threshold = 0.01 }) {
  const blockers = [];
  if (sameMicPosition !== true) blockers.push('microphone position was not affirmatively fixed');
  if (sameSpeaker !== true) blockers.push('speaker identity was not matched');
  if (sameStimulus !== true) blockers.push('stimulus was not matched');
  if (expectedCorrectionMaterial !== true) blockers.push('experiment lacks a correction expected to create a measurable change');
  const relativeRmsDelta = rmsDelta(multEqOff, multEqOn);
  if (relativeRmsDelta == null) blockers.push('OFF/ON response arrays are missing, malformed, or different lengths');
  const changed = relativeRmsDelta != null && relativeRmsDelta > threshold;
  return {
    validControl: blockers.length === 0,
    changed,
    relativeRmsDelta,
    threshold,
    blockers,
    interpretation: blockers.length
      ? 'inconclusive'
      : changed
        ? 'native capture contains a material OFF/ON difference; this supports but does not alone prove post-correction capability'
        : 'native capture is effectively unchanged; treat it as pre-correction-only until contrary hardware evidence exists'
  };
}

export function evaluateNativeMeasurementCapability(evidence = {}) {
  if (evidence.receiverSupported === false) return capability('unsupported', evidence, 'Receiver measurement control was affirmatively shown unsupported.');
  if (evidence.calibrationCapture === true && evidence.normalPlaybackCapture !== true) {
    return capability('calibration-only', evidence, 'Capture is proven only inside the Audyssey calibration workflow.');
  }
  if (evidence.normalPlaybackCapture === true && evidence.correctionExperiment) {
    const experiment = compareCorrectionExperiment(evidence.correctionExperiment);
    if (experiment.validControl && experiment.changed === false) return capability('pre-correction-only', { ...evidence, correctionExperimentResult: experiment }, 'Controlled MultEQ OFF/ON capture did not contain a material correction difference.');
    if (experiment.validControl && experiment.changed === true && evidence.activePresetVerified === true && evidence.capturePathVerified === true) {
      return capability('post-correction-capable', { ...evidence, correctionExperimentResult: experiment }, 'Controlled hardware evidence supports active post-correction capture.');
    }
    return capability('unknown', { ...evidence, correctionExperimentResult: experiment }, 'OFF/ON experiment is not sufficient to graduate post-correction capability.');
  }
  if (evidence.calibrationCapture === true) return capability('calibration-only', evidence, 'Audyssey calibration capture is available, ordinary corrected playback capture remains unproven.');
  return capability('unknown', evidence, 'No controlled X3700H evidence proves a Denon-native post-correction measurement path.');
}

function capability(state, evidence, reason) {
  return Object.freeze({
    state,
    postCorrection: state === 'post-correction-capable',
    usableForSearch: ['calibration-only', 'pre-correction-only', 'post-correction-capable'].includes(state),
    usableForPhysicalVerification: state === 'post-correction-capable',
    hardwareVerification: state === 'unknown' ? 'hardware-unverified' : 'hardware-evidence-required',
    reason,
    evidence
  });
}
