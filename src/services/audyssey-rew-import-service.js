import { parseAdyText } from '../adapters/audyssey-ady.js';
import { measurementsFromAudyssey } from '../measurement/audyssey-measurement-source.js';

export class AudysseyRewImportService {
  constructor(rew) { this.rew = rew; }

  async importText(text, { sourceFilename = 'import.ady', sessionId = null } = {}) {
    const parsed = parseAdyText(text, { sourceFilename });
    const measurements = measurementsFromAudyssey(parsed, { sessionId });
    const imported = [];
    for (const measurement of measurements) {
      imported.push(await this.rew.importImpulseResponseData({
        identifier: `${measurement.channel}-P${measurement.position}`,
        samples: measurement.impulseResponse,
        sampleRateHz: measurement.sampleRateHz,
        startTime: 0,
        splOffset: 0,
        applyCal: false
      }));
    }
    return {
      sourceSha256: parsed.metadata.sourceSha256,
      measurementCount: measurements.length,
      imported,
      rule: 'Audyssey source evidence is imported unchanged as impulse data. REW performs the downstream acoustic analysis.'
    };
  }
}
