const DEFAULT_MAJOR_REGRESSION = 8;

export function compareScores(baseline, candidate, { minimumGain = 0.5, majorRegression = DEFAULT_MAJOR_REGRESSION } = {}) {
  const b = new Map((baseline?.components || []).map(component => [component.name, component]));
  const c = new Map((candidate?.components || []).map(component => [component.name, component]));
  const regressions = [];
  const improvements = [];
  for (const [name, before] of b) {
    const after = c.get(name);
    if (!after) continue;
    const delta = after.score - before.score;
    if (delta <= -majorRegression) regressions.push({ name, before: before.score, after: after.score, delta });
    if (delta > 0) improvements.push({ name, before: before.score, after: after.score, delta });
  }
  const overallDelta = Number.isFinite(baseline?.score) && Number.isFinite(candidate?.score)
    ? candidate.score - baseline.score
    : null;
  const accepted = overallDelta != null && overallDelta >= minimumGain && regressions.length === 0;
  return {
    accepted,
    overallDelta,
    regressions,
    improvements,
    rule: 'Candidate must improve the measured aggregate score and must not contain a major component regression.'
  };
}
