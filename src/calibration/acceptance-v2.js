function componentMap(score) {
  const result = new Map();
  for (const component of score?.components || score?.evaluation?.components || []) {
    if (component?.name && Number.isFinite(Number(component.score))) result.set(component.name, Number(component.score));
  }
  return result;
}

export function assessCandidateAcceptance(champion, candidate, { epsilon = 0.05, defaultMajorRegression = 8, majorRegressionThresholds = {} } = {}) {
  const championValue = Number(champion?.measuredScore ?? champion?.score?.value ?? champion?.score ?? champion?.evaluation?.value);
  const candidateValue = Number(candidate?.measuredScore ?? candidate?.score?.value ?? candidate?.score ?? candidate?.evaluation?.value);
  if (!Number.isFinite(championValue) || !Number.isFinite(candidateValue)) throw new Error('candidate acceptance requires finite measured champion and candidate scores');
  const delta = candidateValue - championValue;
  const regressions = [];
  const before = componentMap(champion?.evaluation || champion?.score || champion);
  const after = componentMap(candidate?.evaluation || candidate?.score || candidate);
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (!before.has(name) || !after.has(name)) continue;
    const componentDelta = after.get(name) - before.get(name);
    const threshold = Number(majorRegressionThresholds[name] ?? defaultMajorRegression);
    if (Number.isFinite(threshold) && componentDelta < -threshold) {
      regressions.push({ name, before: before.get(name), after: after.get(name), delta: componentDelta, threshold });
    }
  }
  if (regressions.length) return { accepted: false, reason: 'major-regression', delta, epsilon, regressions };
  if (delta <= epsilon) return { accepted: false, reason: delta < 0 ? 'aggregate-regression' : 'below-epsilon', delta, epsilon, regressions: [] };
  return { accepted: true, reason: 'measured-improvement', delta, epsilon, regressions: [] };
}
