import { SafetyError } from '../lib/errors.js';

export const PROTECTED_SETTINGS = new Set([
  'ampAssign',
  'speakerExistence',
  'heightSpeakerType',
  'subwooferCount',
  'terminalAssignments',
  'biAmp',
  'preOutConfiguration',
  'hdmiAssignments',
  'triggerOutputs',
  'zone2Routing',
  'speakerImpedance'
]);

export const SAFE_RANGES = Object.freeze({
  masterVolumeDb: [-60, -15],
  trimDb: [-12, 6],
  crossoverHz: [40, 250],
  distanceMeters: [0, 18]
});

export function assertNoProtectedChanges(changes) {
  const protectedRequested = Object.keys(changes || {}).filter(key => PROTECTED_SETTINGS.has(key));
  if (protectedRequested.length) {
    throw new SafetyError('Physical topology settings are protected from automatic changes', { protectedRequested });
  }
}

export function clampCandidate(name, value) {
  const range = SAFE_RANGES[name];
  if (!range) return value;
  return Math.min(range[1], Math.max(range[0], value));
}
