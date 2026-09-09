export const DEFAULT_WEIGHTS = Object.freeze({
  bassIntegration: 0.25,
  crossoverIntegration: 0.20,
  timing: 0.15,
  frequencyResponse: 0.15,
  channelConsistency: 0.10,
  seatConsistency: 0.10,
  headroom: 0.05
});

function bounded(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export function scoreCalibration(metrics, weights = DEFAULT_WEIGHTS) {
  const components = [];
  let weighted = 0;
  let totalWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const score = bounded(metrics?.[name]);
    if (score == null) continue;
    components.push({ name, score, weight });
    weighted += score * weight;
    totalWeight += weight;
  }
  return {
    score: totalWeight ? Math.round((weighted / totalWeight) * 10) / 10 : null,
    confidence: totalWeight >= 0.9 ? 'high' : totalWeight >= 0.6 ? 'medium' : 'low',
    evidenceWeight: Math.round(totalWeight * 1000) / 1000,
    components
  };
}
