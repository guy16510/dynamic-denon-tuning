export function validateTrace(trace) {
  const data = trace?.data?.data || trace?.data || trace;
  const magnitude = Array.isArray(data?.magnitude) ? data.magnitude : [];
  const phase = Array.isArray(data?.phase) ? data.phase : [];
  const finiteMagnitude = magnitude.filter(Number.isFinite);
  const finitePhase = phase.filter(Number.isFinite);
  const issues = [];
  if (finiteMagnitude.length < 100) issues.push('frequency response has fewer than 100 finite magnitude points');
  if (magnitude.length && finiteMagnitude.length / magnitude.length < 0.98) issues.push('frequency response contains too many non-finite values');
  if (phase.length && finitePhase.length / phase.length < 0.95) issues.push('phase response contains too many non-finite values');
  return {
    valid: issues.length === 0,
    issues,
    points: finiteMagnitude.length,
    phasePoints: finitePhase.length
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
  return { valid: issues.length === 0, issues };
}
