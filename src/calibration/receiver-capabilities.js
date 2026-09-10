const PARAMETER_TYPES = Object.freeze(['distance', 'trim', 'crossover']);

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

export function validateReceiverCapabilities(input) {
  if (!input || typeof input !== 'object') throw new Error('receiver capability evidence is required');
  if (!input.receiverModel) throw new Error('receiverModel is required');
  if (!input.evidence || typeof input.evidence !== 'object') throw new Error('receiver capability evidence metadata is required');
  const parameters = {};
  for (const type of PARAMETER_TYPES) {
    const source = input[type];
    if (!source) continue;
    if (Array.isArray(source.allowedValues)) {
      const allowedValues = [...new Set(source.allowedValues.map(value => finite(value, `${type}.allowedValues`)))].sort((a, b) => a - b);
      if (!allowedValues.length) throw new Error(`${type}.allowedValues cannot be empty`);
      parameters[type] = Object.freeze({ allowedValues });
      continue;
    }
    const min = finite(source.min, `${type}.min`);
    const max = finite(source.max, `${type}.max`);
    const step = finite(source.step, `${type}.step`);
    if (step <= 0 || max < min) throw new Error(`${type} requires min <= max and step > 0`);
    parameters[type] = Object.freeze({ min, max, step });
  }
  if (!Object.keys(parameters).length) throw new Error('at least one receiver parameter capability must be evidenced');
  return Object.freeze({
    receiverModel: String(input.receiverModel),
    parameters: Object.freeze(parameters),
    evidence: Object.freeze({ ...input.evidence }),
    hardwareVerification: input.hardwareVerification || 'hardware-unverified'
  });
}

export function candidateGeneratorCapabilities(validated) {
  if (!validated?.parameters) throw new Error('validated receiver capabilities are required');
  return validated.parameters;
}
