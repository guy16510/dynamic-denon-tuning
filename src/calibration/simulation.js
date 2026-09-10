import { runDeterministicOptimization } from './optimizer-v2.js';

export async function runSyntheticScenario(scenario) {
  if (scenario?.synthetic !== true) throw new Error('simulation fixtures must be explicitly marked synthetic: true');
  const baseline = {
    candidateId: 'baseline',
    sequence: 0,
    measuredScore: Number(scenario.baseline.value),
    changes: [],
    evaluation: { value: Number(scenario.baseline.value), components: scenario.baseline.components || [] }
  };
  const candidates = (scenario.candidates || []).map((candidate, index) => ({
    candidateId: candidate.candidateId || `candidate-${String(index + 1).padStart(4, '0')}`,
    sequence: index + 1,
    changes: candidate.changes || [],
    synthetic: true,
    legal: candidate.legal !== false
  }));
  const evaluationById = new Map((scenario.candidates || []).map((candidate, index) => [candidates[index].candidateId, { value: Number(candidate.value), components: candidate.components || [] }]));
  const result = await runDeterministicOptimization({
    baseline,
    candidates,
    evaluate: candidate => evaluationById.get(candidate.candidateId),
    constraints: { validate: candidate => candidate.legal ? [] : ['synthetic illegal receiver value'] },
    epsilon: scenario.epsilon ?? 0.05,
    defaultMajorRegression: scenario.majorRegression ?? 8,
    maximumCandidateCount: scenario.maximumCandidateCount ?? 200,
    noImprovementLimit: scenario.noImprovementLimit ?? Infinity
  });
  return { synthetic: true, scenario: scenario.name, ...result };
}
