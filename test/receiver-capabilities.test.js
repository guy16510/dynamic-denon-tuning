import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceiverCapabilities, candidateGeneratorCapabilities } from '../src/calibration/receiver-capabilities.js';

test('receiver search bounds require explicit evidence instead of guessed X3700H values', () => {
  assert.throws(() => validateReceiverCapabilities({ receiverModel: 'AVR-X3700H', evidence: {} }), /parameter capability/);
  const result = validateReceiverCapabilities({ receiverModel: 'AVR-X3700H', distance: { min: 0, max: 18, step: 0.01 }, crossover: { allowedValues: [100, 60, 80, 80] }, evidence: { source: 'hardware-observation' }, hardwareVerification: 'hardware-unverified' });
  assert.deepEqual(candidateGeneratorCapabilities(result).crossover.allowedValues, [60, 80, 100]);
});
