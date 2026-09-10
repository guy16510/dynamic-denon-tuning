import { readFile } from 'node:fs/promises';
import { canonicalJson, sha256 } from '../lib/canonical-json.js';
import { DEFAULT_WEIGHTS } from './score.js';

export function validateTargetProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('target profile must be an object');
  if (!profile.name || !Number.isInteger(profile.version)) throw new Error('target profile requires name and integer version');
  const weights = profile.weights || {};
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const weight = Number(weights[key]);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`target profile weight ${key} must be between 0 and 1`);
  }
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value), 0);
  if (Math.abs(total - 1) > 0.000001) throw new Error(`target profile weights must sum to 1, received ${total}`);
  if (!Array.isArray(profile.seats) || profile.seats.length === 0) throw new Error('target profile requires at least one seat definition');
  return profile;
}

export function lockTargetProfile(profile) {
  validateTargetProfile(profile);
  const snapshot = structuredClone(profile);
  const canonical = canonicalJson(snapshot);
  return Object.freeze({ snapshot: Object.freeze(snapshot), canonical, sha256: sha256(canonical) });
}

export async function loadAndLockTargetProfile(path) {
  const profile = JSON.parse(await readFile(path, 'utf8'));
  return lockTargetProfile(profile);
}
