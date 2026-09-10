function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createCandidate(input) {
  if (!input?.candidateId) throw new Error('candidateId is required');
  if (!input?.targetProfileHash) throw new Error('targetProfileHash is required');
  return deepFreeze({
    candidateId: String(input.candidateId),
    sequence: Number(input.sequence ?? 0),
    parentCandidateId: input.parentCandidateId || null,
    distances: { ...(input.distances || {}) },
    trims: { ...(input.trims || {}) },
    crossovers: { ...(input.crossovers || {}) },
    subwooferSettings: { ...(input.subwooferSettings || {}) },
    targetCurve: input.targetCurve || null,
    audysseySettings: { ...(input.audysseySettings || {}) },
    sourceMeasurements: [...(input.sourceMeasurements || [])],
    targetProfileHash: input.targetProfileHash,
    predictedScore: input.predictedScore ?? null,
    measuredScore: input.measuredScore ?? null,
    changes: [...(input.changes || [])],
    state: input.state || 'generated'
  });
}

export function adjustmentMagnitude(candidate) {
  return (candidate.changes || []).reduce((sum, change) => sum + Math.abs(Number(change.to) - Number(change.from)), 0);
}

export function compareCandidates(a, b, epsilon = 0.05) {
  const scoreA = Number(a.measuredScore ?? a.score ?? -Infinity);
  const scoreB = Number(b.measuredScore ?? b.score ?? -Infinity);
  if (Math.abs(scoreA - scoreB) > epsilon) return scoreB - scoreA;
  const countDelta = (a.changes?.length || 0) - (b.changes?.length || 0);
  if (countDelta) return countDelta;
  const magnitudeDelta = adjustmentMagnitude(a) - adjustmentMagnitude(b);
  if (Math.abs(magnitudeDelta) > 1e-12) return magnitudeDelta;
  return Number(a.sequence ?? 0) - Number(b.sequence ?? 0);
}
