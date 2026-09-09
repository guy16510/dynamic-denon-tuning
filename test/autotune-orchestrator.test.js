import test from 'node:test';
import assert from 'node:assert/strict';
import { AutotuneOrchestrator } from '../src/services/autotune-orchestrator.js';

function fixture() {
  const events = [];
  let workflow = {
    sessionId: 'parent',
    status: 'verification_required',
    phase: 'post_calibration_verification',
    positions: 2,
    channels: ['FL', 'FR', 'C'],
    topology: { channels: ['FL', 'FR', 'C'] },
    sweepManifestPath: '/tmp/sweeps.json',
    nextAction: 'start verification'
  };
  const theater = {
    async status() { return structuredClone(workflow); },
    async saveWorkflow(sessionId, next, type, data) {
      assert.equal(sessionId, 'parent');
      workflow = structuredClone(next);
      events.push({ type, data });
      return workflow;
    }
  };
  let startCalls = 0;
  const childStatus = { baseline: 'awaiting_preset', candidate: 'awaiting_preset' };
  const verification = {
    async start(args) {
      startCalls += 1;
      assert.deepEqual(args, {
        positions: 2,
        channels: ['FL', 'FR', 'C'],
        sweepManifestPath: '/tmp/sweeps.json',
        topology: ['FL', 'FR', 'C']
      });
      return { baselineSessionId: 'b', candidateSessionId: 'c', nextAction: 'Select Speaker Preset 1, then resume.' };
    },
    async advance({ sessionId }) {
      if (sessionId === 'b') {
        childStatus.baseline = 'complete';
        return { state: { sessionId: 'b', status: 'complete' }, completed: true };
      }
      childStatus.candidate = 'complete';
      return { state: { sessionId: 'c', status: 'complete' }, completed: true };
    },
    async resumeManual({ sessionId }) {
      return { state: { sessionId, status: 'complete' }, completed: true };
    },
    async finalize(args) {
      assert.deepEqual(args, {
        baselineSessionId: 'b',
        candidateSessionId: 'c',
        reportSessionId: 'parent',
        minimumGain: 0.5,
        majorRegression: 8
      });
      return {
        finalized: true,
        accepted: true,
        status: 'complete',
        recommendedPreset: 2,
        verificationPath: '/parent/optimized/final-verification.json',
        reportPath: '/parent/report.md',
        baseline: { score: { score: 70 } },
        candidate: { score: { score: 82 } },
        comparison: { overallDelta: 12 },
        gates: [],
        nextAction: 'Preset 2 won measured verification and is the recommended preset.'
      };
    }
  };
  return { theater, verification, events, startCalls: () => startCalls, getWorkflow: () => workflow };
}

test('parent verification start is idempotent and inherits exact autotune definition', async () => {
  const f = fixture();
  const service = new AutotuneOrchestrator({ theater: f.theater, verification: f.verification });
  const first = await service.beginVerification({ sessionId: 'parent' });
  assert.equal(first.created, true);
  assert.equal(first.baselineSessionId, 'b');
  assert.equal(first.candidateSessionId, 'c');
  assert.equal(f.getWorkflow().status, 'verification_preset_1');
  const second = await service.beginVerification({ sessionId: 'parent' });
  assert.equal(second.idempotent, true);
  assert.equal(f.startCalls(), 1);
});

test('parent verification advances Preset 1 then Preset 2 and requires measured finalization', async () => {
  const f = fixture();
  const service = new AutotuneOrchestrator({ theater: f.theater, verification: f.verification });
  await service.beginVerification({ sessionId: 'parent' });
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  assert.equal(f.getWorkflow().status, 'verification_preset_2');
  assert.match(f.getWorkflow().nextAction, /Speaker Preset 2/);
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  assert.equal(f.getWorkflow().status, 'verification_finalize_required');
});

test('measured verification winner is written back to the parent workflow', async () => {
  const f = fixture();
  const service = new AutotuneOrchestrator({ theater: f.theater, verification: f.verification });
  await service.beginVerification({ sessionId: 'parent' });
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  const result = await service.finalizeVerification({ sessionId: 'parent' });
  assert.equal(result.workflow.status, 'complete');
  assert.equal(result.workflow.recommendedPreset, 2);
  assert.equal(result.workflow.verification.accepted, true);
  assert.equal(result.workflow.verification.reportPath, '/parent/report.md');
});

test('measured regression writes Preset 1 rollback recommendation to parent workflow', async () => {
  const f = fixture();
  f.verification.finalize = async () => ({
    finalized: true,
    accepted: false,
    status: 'regression_rejected',
    recommendedPreset: 1,
    verificationPath: '/parent/optimized/final-verification.json',
    reportPath: '/parent/report.md',
    baseline: { score: { score: 80 } },
    candidate: { score: { score: 72 } },
    comparison: { overallDelta: -8 },
    gates: ['candidate has a major component regression'],
    nextAction: 'Return to Speaker Preset 1.'
  });
  const service = new AutotuneOrchestrator({ theater: f.theater, verification: f.verification });
  await service.beginVerification({ sessionId: 'parent' });
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  await service.advanceVerification({ sessionId: 'parent', ready: true });
  const result = await service.finalizeVerification({ sessionId: 'parent' });
  assert.equal(result.workflow.status, 'regression_rejected');
  assert.equal(result.workflow.recommendedPreset, 1);
  assert.match(result.workflow.nextAction, /Preset 1/);
});
