import { evaluateNativeMeasurementCapability } from '../measurement/native-measurement-capability.js';

export class NativeMeasurementProbeService {
  constructor({ config, sessions }) {
    this.config = config;
    this.sessions = sessions;
  }

  async probe({ sessionId = null } = {}) {
    if (this.config.calibration.nativeMeasurement === 'off') {
      return evaluateNativeMeasurementCapability({ receiverSupported: false, source: 'configuration' });
    }
    let evidence = {};
    if (sessionId) {
      try { evidence = await this.sessions.readJson(sessionId, 'receiver/native-measurement-evidence.json'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const result = evaluateNativeMeasurementCapability(evidence);
    return {
      ...result,
      probeMode: 'evidence-only',
      networkMutationAttempted: false,
      nextHardwareGate: result.state === 'post-correction-capable' ? null : 'H4/H5: capture Audyssey protocol traffic, then compare fixed-mic MultEQ OFF vs ON measurements',
      rule: 'This probe never invents or sends undocumented Denon/Audyssey protocol commands.'
    };
  }

  async recordEvidence({ sessionId, evidence }) {
    if (!sessionId) throw new Error('sessionId is required');
    const result = evaluateNativeMeasurementCapability(evidence);
    await this.sessions.writeJson(sessionId, 'receiver/native-measurement-evidence.json', evidence);
    await this.sessions.writeJson(sessionId, 'receiver/capabilities.json', result);
    return result;
  }
}
