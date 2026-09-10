export class ChampionStore {
  constructor({ sessions, events }) {
    this.sessions = sessions;
    this.events = events;
  }

  async current(sessionId) {
    try { return await this.sessions.readJson(sessionId, 'champion/champion.json'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async initialize(sessionId, baseline) {
    if (!baseline?.candidateId) throw new Error('baseline champion requires candidateId');
    const existing = await this.current(sessionId);
    if (existing) return existing;
    const champion = { ...baseline, role: 'baseline', promotedAtEvent: null };
    await this.sessions.writeJson(sessionId, 'champion/champion.json', champion, { overwrite: true });
    const event = await this.events.append(sessionId, 'champion.changed', { from: null, to: baseline.candidateId, reason: 'baseline-established', measuredScore: baseline.measuredScore ?? baseline.score ?? null });
    champion.promotedAtEvent = event.sequence;
    await this.sessions.writeJson(sessionId, 'champion/champion.json', champion, { overwrite: true });
    return champion;
  }

  async promote(sessionId, candidate, acceptance) {
    if (!candidate?.candidateId) throw new Error('candidate champion requires candidateId');
    if (acceptance?.accepted !== true) throw new Error('cannot promote a rejected candidate');
    const previous = await this.current(sessionId);
    const event = await this.events.append(sessionId, 'champion.changed', {
      from: previous?.candidateId || null,
      to: candidate.candidateId,
      reason: acceptance.reason,
      delta: acceptance.delta,
      measuredScore: candidate.measuredScore ?? candidate.score?.value ?? candidate.score ?? null
    });
    const champion = { ...candidate, role: 'champion', promotedAtEvent: event.sequence };
    await this.sessions.writeJson(sessionId, 'champion/champion.json', champion, { overwrite: true });
    return champion;
  }
}
