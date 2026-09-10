import { compareCandidates } from './candidate.js';

export const OPTIMIZER_ALGORITHM_VERSION = 'deterministic-search-v2.1';

export function validateCandidateConstraints(candidate, constraints = {}) {
  const violations = [];
  if (typeof constraints.validate === 'function') {
    for (const item of constraints.validate(candidate) || []) violations.push(String(item));
  }
  if (Number.isFinite(constraints.maxAdjustmentMagnitude)) {
    for (const change of candidate.changes || []) {
      if (Math.abs(Number(change.to) - Number(change.from)) > constraints.maxAdjustmentMagnitude) violations.push(`${change.kind}:${change.key} exceeds maximum adjustment magnitude`);
    }
  }
  return { valid: violations.length === 0, violations };
}

function evaluatedCandidate(candidate, result) {
  const score = Number(result?.score ?? result?.value);
  if (!Number.isFinite(score)) throw new Error(`candidate ${candidate.candidateId} evaluator did not return a finite score`);
  return Object.freeze({ ...candidate, measuredScore: score, score, evaluation: result, state: 'measured' });
}

export async function runDeterministicOptimization({ baseline, candidates, evaluate, constraints = {}, epsilon = 0.05, maximumCandidateCount = 200, noImprovementLimit = Infinity }) {
  if (!baseline || !Number.isFinite(Number(baseline.measuredScore ?? baseline.score))) throw new Error('baseline requires a measured score');
  if (typeof evaluate !== 'function') throw new Error('deterministic evaluator is required');
  let champion = Object.freeze({ ...baseline, measuredScore: Number(baseline.measuredScore ?? baseline.score), score: Number(baseline.measuredScore ?? baseline.score) });
  const history = [];
  let noImprovement = 0;
  const budget = Math.min(candidates.length, maximumCandidateCount);
  for (let i = 0; i < budget; i += 1) {
    const candidate = candidates[i];
    const gate = validateCandidateConstraints(candidate, constraints);
    if (!gate.valid) {
      history.push({ candidateId: candidate.candidateId, sequence: candidate.sequence, decision: 'REJECT', reason: 'constraint', violations: gate.violations });
      noImprovement += 1;
      continue;
    }
    const measured = evaluatedCandidate(candidate, await evaluate(candidate));
    const ranked = [champion, measured].sort((a, b) => compareCandidates(a, b, epsilon));
    const wins = ranked[0].candidateId === measured.candidateId && measured.measuredScore > champion.measuredScore + epsilon;
    if (wins) {
      history.push({ candidateId: measured.candidateId, sequence: measured.sequence, score: measured.measuredScore, delta: measured.measuredScore - champion.measuredScore, decision: 'ACCEPT', previousChampion: champion.candidateId });
      champion = measured;
      noImprovement = 0;
    } else {
      history.push({ candidateId: measured.candidateId, sequence: measured.sequence, score: measured.measuredScore, delta: measured.measuredScore - champion.measuredScore, decision: 'REJECT', reason: 'not-better' });
      noImprovement += 1;
    }
    if (noImprovement >= noImprovementLimit) break;
  }
  return Object.freeze({ algorithmVersion: OPTIMIZER_ALGORITHM_VERSION, champion, history, evaluatedCount: history.length, converged: history.length < candidates.length || history.length >= budget });
}
