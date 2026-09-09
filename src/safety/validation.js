export function validateTrace(trace) {
  const data = trace?.data?.data || trace?.data || trace;
  const magnitude = Array.isArray(data?.magnitude) ? data.magnitude : [];
  const phase = Array.isArray(data?.phase) ? data.phase : [];
  const frequency = Array.isArray(data?.frequency) ? data.frequency : [];
  const finiteMagnitude = magnitude.filter(Number.isFinite);
  const finitePhase = phase.filter(Number.isFinite);
  const issues = [];
  if (finiteMagnitude.length < 100) issues.push('frequency response has fewer than 100 finite magnitude points');
  if (magnitude.length && finiteMagnitude.length / magnitude.length < 0.98) issues.push('frequency response contains too many non-finite values');
  if (phase.length && finitePhase.length / phase.length < 0.95) issues.push('phase response contains too many non-finite values');
  if (frequency.length) {
    if (frequency.length !== magnitude.length) issues.push('frequency axis length does not match magnitude length');
    const finiteFrequency = frequency.filter(Number.isFinite);
    if (finiteFrequency.length !== frequency.length) issues.push('frequency axis contains non-finite values');
    if (finiteFrequency.some(value => value <= 0)) issues.push('frequency axis contains non-positive values');
    for (let i = 1; i < finiteFrequency.length; i += 1) {
      if (finiteFrequency[i] <= finiteFrequency[i - 1]) {
        issues.push('frequency axis is not strictly increasing');
        break;
      }
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    points: finiteMagnitude.length,
    phasePoints: finitePhase.length,
    frequencyPoints: frequency.length
  };
}

export function validateMeasurementRecord(record) {
  const issues = [];
  if (!record?.rewId) issues.push('missing REW measurement id');
  if (!record?.channel) issues.push('missing expected channel');
  if (!Number.isInteger(record?.position) || record.position < 0) issues.push('invalid microphone position');
  if (!record?.measurementType) issues.push('missing measurement type');
  if (!record?.traces?.frequencyResponse) issues.push('missing frequency response trace');
  if (!record?.quality) issues.push('missing measurement quality evidence');
  else if (record.quality.valid !== true) issues.push(...(record.quality.issues || ['measurement quality gate did not affirmatively pass']));
  const settingsRequired = Boolean(record?.shieldFile) || record?.measurementType === 'hardware-proof' || record?.measurementType === 'post-calibration-verification';
  if (settingsRequired) {
    const settings = record?.measurementSettings;
    if (!settings) issues.push('missing negotiated REW measurement settings');
    else {
      if (!settings.command) issues.push('missing REW measurement command');
      if (!settings.playbackMode) issues.push('missing REW playback mode');
      if (!settings.measurementMode) issues.push('missing REW measurement mode');
      if (!settings.stimulus) issues.push('missing REW file-playback stimulus identity');
    }
  }
  return { valid: issues.length === 0, issues };
}
