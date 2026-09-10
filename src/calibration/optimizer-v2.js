import { assessCandidateAcceptance } from './acceptance-v2.js';

export const OPTIMIZER_ALGORITHM_VERSION = 'deterministic-search-v2.2';

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

export async function runDeterministicOptimization({ baseline, candidates, evaluate, constraints = {}, epsilon = 0.05, maximumCandidateCount = 200, noImprovementLimit = Infinity, defaultMajorRegression = 8, majorRegressionThresholds = {} }) {
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
      if (noImprovement >= noImprovementLimit) break;
      continue;
    }
    const measured = evaluatedCandidate(candidate, await evaluate(candidate));
    const acceptance = assessCandidateAcceptance(champion, measured, { epsilon, defaultMajorRegression, majorRegressionThresholds });
    if (acceptance.accepted) {
      history.push({ candidateId: measured.candidateId, sequence: measured.sequence, score: measured.measuredScore, delta: acceptance.delta, decision: 'ACCEPT', reason: acceptance.reason, previousChampion: champion.candidateId, regressions: [] });
      champion = measured;
      noImprovement = 0;
    } else {
      history.push({ candidateId: measured.candidateId, sequence: measured.sequence, score: measured.measuredScore, delta: acceptance.delta, decision: 'REJECT', reason: acceptance.reason, regressions: acceptance.regressions });
      noImprovement += 1;
    }
    if (noImprovement >= noImprovementLimit) break;
  }
  const stoppedByBudget = history.length >= budget && budget < candidates.length;
  const stoppedByNoImprovement = noImprovement >= noImprovementLimit;
  const exhaustedCandidates = history.length >= candidates.length;
  return Object.freeze({ algorithmVersion: OPTIMIZER_ALGORITHM_VERSION, champion, history, evaluatedCount: history.length, converged: exhaustedCandidates || stoppedByNoImprovement, stopReason: exhaustedCandidates ? 'candidate-space-exhausted' : stoppedByNoImprovement ? 'no-meaningful-improvement' : stoppedByBudget ? 'candidate-budget' : 'completed' });
}
