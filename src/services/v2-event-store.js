import { appendFile, readFile } from 'node:fs/promises';

export class V2EventStore {
  constructor({ sessions, bus }) {
    this.sessions = sessions;
    this.bus = bus;
    this.queues = new Map();
  }

  async read(sessionId) {
    try {
      const text = await readFile(this.sessions.path(sessionId, 'events.jsonl'), 'utf8');
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async append(sessionId, type, data = {}) {
    const previous = this.queues.get(sessionId) || Promise.resolve();
    const next = previous.then(async () => {
      const existing = await this.read(sessionId);
      const event = Object.freeze({
        schemaVersion: 2,
        sequence: existing.length + 1,
        at: new Date().toISOString(),
        sessionId,
        type,
        data
      });
      await appendFile(this.sessions.path(sessionId, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
      this.bus?.publish(event);
      return event;
    });
    this.queues.set(sessionId, next.catch(() => {}));
    return next;
  }
}
