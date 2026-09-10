import { canonicalJson, sha256 } from '../lib/canonical-json.js';
import { runDeterministicOptimization, OPTIMIZER_ALGORITHM_VERSION } from './optimizer-v2.js';

export async function replayOptimization({ measurementHashes, targetProfileHash, baseline, candidates, evaluations, epsilon = 0.05, maximumCandidateCount = 200, noImprovementLimit = Infinity }) {
  const result = await runDeterministicOptimization({
    baseline,
    candidates,
    epsilon,
    maximumCandidateCount,
    noImprovementLimit,
    evaluate: candidate => {
      const evaluation = evaluations[candidate.candidateId];
      if (!evaluation) throw new Error(`missing replay evaluation for ${candidate.candidateId}`);
      return evaluation;
    }
  });
  const deterministic = {
    measurementHashes: [...measurementHashes].sort(),
    targetProfileHash,
    algorithmVersion: OPTIMIZER_ALGORITHM_VERSION,
    candidateSequence: result.history.map(item => item.candidateId),
    decisions: result.history.map(item => ({ candidateId: item.candidateId, score: item.score ?? null, decision: item.decision, reason: item.reason ?? null })),
    championId: result.champion.candidateId,
    finalScore: result.champion.measuredScore
  };
  return { ...result, deterministicDigest: sha256(canonicalJson(deterministic)), deterministic };
}
