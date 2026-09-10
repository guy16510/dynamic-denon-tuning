import { assessCandidateAcceptance } from '../calibration/acceptance-v2.js';

export class CandidateTransaction {
  constructor({ events, championStore, io, acceptance = {} }) {
    this.events = events;
    this.championStore = championStore;
    this.io = io;
    this.acceptance = acceptance;
  }

  async execute({ sessionId, candidate }) {
    if (!sessionId) throw new Error('sessionId is required');
    if (!candidate?.candidateId) throw new Error('physical candidate mutation requires candidateId');
    const champion = await this.championStore.current(sessionId);
    if (!champion) throw new Error('physical candidate evaluation requires an established champion');
    await this.events.append(sessionId, 'candidate.application-started', { candidateId: candidate.candidateId, championId: champion.candidateId });
    const snapshot = await this.io.snapshot({ sessionId, candidateId: candidate.candidateId });
    const protection = await this.io.verifyPresetProtection({ sessionId, candidateId: candidate.candidateId, snapshot });
    if (protection?.safe !== true) return this.rejectBeforeMutation(sessionId, candidate, champion, 'preset-protection-unverified', protection);
    const prepared = await this.io.prepare({ sessionId, candidate, snapshot, targetPreset: 2 });
    const applied = await this.io.apply({ sessionId, candidate, prepared, targetPreset: 2 });
    if (applied?.preset !== 2) return this.rejectAfterMutation(sessionId, candidate, champion, 'candidate-not-verified-on-preset-2', applied);
    const verified = await this.io.verifyApplied({ sessionId, candidate, applied, targetPreset: 2 });
    if (verified?.verified !== true) return this.rejectAfterMutation(sessionId, candidate, champion, 'candidate-readback-failed', verified);
    await this.events.append(sessionId, 'candidate.applied', { candidateId: candidate.candidateId, preset: 2 });
    const measurement = await this.io.measure({ sessionId, candidateId: candidate.candidateId, candidate });
    const evidence = await this.io.validateEvidence({ sessionId, candidateId: candidate.candidateId, measurement });
    if (evidence?.valid !== true) return this.rejectAfterMutation(sessionId, candidate, champion, 'measurement-evidence-invalid', evidence);
    const score = await this.io.score({ sessionId, candidateId: candidate.candidateId, measurement, evidence });
    const measuredCandidate = { ...candidate, measuredScore: Number(score.value ?? score.score), score, evaluation: score };
    await this.events.append(sessionId, 'score.calculated', { candidateId: candidate.candidateId, score });
    const acceptance = assessCandidateAcceptance(champion, measuredCandidate, this.acceptance);
    if (!acceptance.accepted) return this.rejectAfterMutation(sessionId, measuredCandidate, champion, acceptance.reason, acceptance);
    const promoted = await this.championStore.promote(sessionId, measuredCandidate, acceptance);
    await this.events.append(sessionId, 'candidate.accepted', { candidateId: candidate.candidateId, previousChampion: champion.candidateId, championId: promoted.candidateId, acceptance });
    return { accepted: true, candidate: measuredCandidate, champion: promoted, acceptance };
  }

  async rejectBeforeMutation(sessionId, candidate, champion, reason, detail) {
    await this.events.append(sessionId, 'candidate.rejected', { candidateId: candidate.candidateId, reason, detail, mutationAttempted: false, championId: champion.candidateId });
    return { accepted: false, reason, detail, champion, mutationAttempted: false };
  }

  async rejectAfterMutation(sessionId, candidate, champion, reason, detail) {
    const restored = await this.io.restoreChampion({ sessionId, candidateId: candidate.candidateId, champion });
    await this.events.append(sessionId, 'candidate.rejected', { candidateId: candidate.candidateId, reason, detail, mutationAttempted: true, restoredChampion: restored?.verified === true, championId: champion.candidateId });
    return { accepted: false, reason, detail, champion, mutationAttempted: true, restoredChampion: restored };
  }
}
