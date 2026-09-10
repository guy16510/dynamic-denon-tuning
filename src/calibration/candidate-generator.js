import { createCandidate } from './candidate.js';

function legalValues(family, receiverCapabilities) {
  const capability = receiverCapabilities?.[family.kind];
  if (!capability) throw new Error(`receiver capability missing for ${family.kind}`);
  let values;
  if (Array.isArray(capability.allowedValues)) values = capability.allowedValues.map(Number);
  else if (Number.isFinite(capability.min) && Number.isFinite(capability.max) && Number.isFinite(capability.step) && capability.step > 0) {
    values = [];
    for (let value = capability.min; value <= capability.max + 1e-9; value += capability.step) values.push(Number(value.toFixed(6)));
  } else throw new Error(`receiver capability for ${family.kind} has no legal value model`);
  const requested = family.values ? family.values.map(Number) : values;
  const legal = new Set(values.map(value => Number(value.toFixed(6))));
  return [...new Set(requested.map(value => Number(value.toFixed(6))))].filter(value => legal.has(value)).sort((a, b) => a - b);
}

function stateForKind(candidate, kind) {
  if (kind === 'distance') return candidate.distances;
  if (kind === 'trim') return candidate.trims;
  if (kind === 'crossover') return candidate.crossovers;
  throw new Error(`unsupported parameter family kind: ${kind}`);
}

export function generateCandidateSequence({ champion, targetProfileHash, receiverCapabilities, parameterFamilies }) {
  if (!champion) throw new Error('champion candidate/state is required');
  const candidates = [];
  let sequence = 1;
  for (const family of parameterFamilies || []) {
    const currentMap = stateForKind(champion, family.kind);
    const current = Number(family.current ?? currentMap?.[family.key]);
    if (!Number.isFinite(current)) throw new Error(`current ${family.kind} for ${family.key} is required`);
    for (const value of legalValues(family, receiverCapabilities)) {
      if (Math.abs(value - current) < 1e-9) continue;
      const patch = { distances: champion.distances, trims: champion.trims, crossovers: champion.crossovers };
      const mapName = family.kind === 'distance' ? 'distances' : family.kind === 'trim' ? 'trims' : 'crossovers';
      patch[mapName] = { ...patch[mapName], [family.key]: value };
      candidates.push(createCandidate({
        ...champion,
        ...patch,
        candidateId: `candidate-${String(sequence).padStart(4, '0')}`,
        sequence,
        parentCandidateId: champion.candidateId || null,
        targetProfileHash,
        measuredScore: null,
        predictedScore: null,
        changes: [{ kind: family.kind, key: family.key, from: current, to: value, stage: family.stage || null }],
        state: 'generated'
      }));
      sequence += 1;
    }
  }
  return candidates;
}
