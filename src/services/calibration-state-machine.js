export const CALIBRATION_STATES = Object.freeze([
  'CREATED', 'PREFLIGHT', 'BLOCKED', 'ACQUIRE_BASELINE', 'BASELINE_READY', 'OPTIMIZING',
  'CANDIDATE_GENERATED', 'CANDIDATE_READY', 'APPLYING', 'APPLIED', 'MEASURING',
  'MEASUREMENT_READY', 'EVALUATING', 'CANDIDATE_ACCEPTED', 'CANDIDATE_REJECTED',
  'CONVERGED', 'FINAL_VERIFICATION', 'COMPLETE', 'PAUSED', 'ABORTED', 'FAILED'
]);

const NORMAL = {
  CREATED: ['PREFLIGHT', 'ABORTED'],
  PREFLIGHT: ['BLOCKED', 'ACQUIRE_BASELINE', 'BASELINE_READY', 'FAILED', 'PAUSED', 'ABORTED'],
  BLOCKED: ['PREFLIGHT', 'PAUSED', 'ABORTED', 'FAILED'],
  ACQUIRE_BASELINE: ['BASELINE_READY', 'BLOCKED', 'FAILED', 'PAUSED', 'ABORTED'],
  BASELINE_READY: ['OPTIMIZING', 'BLOCKED', 'PAUSED', 'ABORTED', 'FAILED'],
  OPTIMIZING: ['CANDIDATE_GENERATED', 'CONVERGED', 'BLOCKED', 'PAUSED', 'ABORTED', 'FAILED'],
  CANDIDATE_GENERATED: ['CANDIDATE_READY', 'CANDIDATE_REJECTED', 'PAUSED', 'ABORTED', 'FAILED'],
  CANDIDATE_READY: ['APPLYING', 'CANDIDATE_REJECTED', 'PAUSED', 'ABORTED', 'FAILED'],
  APPLYING: ['APPLIED', 'CANDIDATE_REJECTED', 'BLOCKED', 'FAILED', 'ABORTED'],
  APPLIED: ['MEASURING', 'BLOCKED', 'FAILED', 'ABORTED'],
  MEASURING: ['MEASUREMENT_READY', 'CANDIDATE_REJECTED', 'BLOCKED', 'PAUSED', 'ABORTED', 'FAILED'],
  MEASUREMENT_READY: ['EVALUATING', 'CANDIDATE_REJECTED', 'FAILED', 'ABORTED'],
  EVALUATING: ['CANDIDATE_ACCEPTED', 'CANDIDATE_REJECTED', 'FAILED', 'ABORTED'],
  CANDIDATE_ACCEPTED: ['OPTIMIZING', 'CONVERGED', 'PAUSED', 'ABORTED'],
  CANDIDATE_REJECTED: ['OPTIMIZING', 'CONVERGED', 'PAUSED', 'ABORTED'],
  CONVERGED: ['FINAL_VERIFICATION', 'COMPLETE', 'PAUSED', 'ABORTED'],
  FINAL_VERIFICATION: ['COMPLETE', 'BLOCKED', 'FAILED', 'ABORTED'],
  COMPLETE: [], ABORTED: [], FAILED: []
};

export function canTransition(from, to) {
  if (!CALIBRATION_STATES.includes(to)) return false;
  if (from === 'PAUSED') return !['CREATED', 'PAUSED'].includes(to);
  return (NORMAL[from] || []).includes(to);
}

export class CalibrationStateMachine {
  constructor({ events }) { this.events = events; }

  async state(sessionId) {
    const history = await this.events.read(sessionId);
    const changes = history.filter(event => event.type === 'session.state-changed');
    return changes.length ? changes.at(-1).data.to : 'CREATED';
  }

  async transition(sessionId, to, data = {}) {
    const from = await this.state(sessionId);
    if (!canTransition(from, to)) throw new Error(`invalid calibration state transition ${from} -> ${to}`);
    await this.events.append(sessionId, 'session.state-changed', { from, to, ...data });
    return { from, to };
  }
}
