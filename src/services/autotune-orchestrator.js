export class AutotuneOrchestrator {
  constructor({ theater, verification }) {
    this.theater = theater;
    this.verification = verification;
  }

  async beginVerification({ sessionId }) {
    const workflow = await this.theater.status(sessionId);
    if (workflow.verificationSessions) {
      return {
        created: false,
        idempotent: true,
        workflow,
        ...workflow.verificationSessions,
        nextAction: workflow.nextAction
      };
    }
    if (workflow.status !== 'verification_required') {
      throw new Error(`verification can only start from verification_required, current status is ${workflow.status}`);
    }
    if (!workflow.sweepManifestPath) throw new Error('verification requires the original sweep manifest');
    if (!Array.isArray(workflow.channels) || !workflow.channels.length) throw new Error('verification requires the original active channels');
    if (!Number.isInteger(workflow.positions) || workflow.positions < 1) throw new Error('verification requires the original microphone position count');

    const topology = Array.isArray(workflow.topology?.channels) && workflow.topology.channels.length
      ? workflow.topology.channels
      : workflow.channels;
    const started = await this.verification.start({
      positions: workflow.positions,
      channels: [...workflow.channels],
      sweepManifestPath: workflow.sweepManifestPath,
      topology: [...topology]
    });
    workflow.verificationSessions = {
      baselineSessionId: started.baselineSessionId,
      candidateSessionId: started.candidateSessionId
    };
    workflow.status = 'verification_preset_1';
    workflow.phase = 'verification_preset_1';
    workflow.nextAction = started.nextAction;
    await this.theater.saveWorkflow(sessionId, workflow, 'verification.started', {
      ...workflow.verificationSessions,
      positions: workflow.positions,
      channels: workflow.channels,
      topology
    });
    return { created: true, workflow, ...workflow.verificationSessions, nextAction: workflow.nextAction };
  }

  async syncAfterChild({ sessionId, workflow, side, childResult, eventType }) {
    const childState = childResult?.state;
    if (childState?.status === 'complete') {
      if (side === 'baseline') {
        workflow.status = 'verification_preset_2';
        workflow.phase = 'verification_preset_2';
        workflow.nextAction = 'Select Speaker Preset 2, then resume candidate verification.';
      } else {
        workflow.status = 'verification_finalize_required';
        workflow.phase = 'verification_finalize';
        workflow.nextAction = 'Both preset verification datasets are complete. Run measured verification finalization.';
      }
    } else if (childResult?.retryRequired) {
      workflow.nextAction = childState?.nextAction || 'Correct the failed verification measurement and retry.';
    } else if (childResult?.requiresUser || childResult?.blocked) {
      workflow.nextAction = childResult?.instruction || childResult?.nextAction || childState?.nextAction || workflow.nextAction;
    }
    await this.theater.saveWorkflow(sessionId, workflow, eventType, {
      side,
      childSessionId: childState?.sessionId || null,
      childStatus: childState?.status || null,
      retryRequired: Boolean(childResult?.retryRequired),
      blocked: Boolean(childResult?.blocked)
    });
    return { workflow, child: childResult, nextAction: workflow.nextAction };
  }

  async advanceVerification({ sessionId, ready = false }) {
    const workflow = await this.theater.status(sessionId);
    const sessions = workflow.verificationSessions;
    if (!sessions) throw new Error('parent autotune session has no verification datasets');
    let side;
    let childSessionId;
    if (workflow.status === 'verification_preset_1') {
      side = 'baseline';
      childSessionId = sessions.baselineSessionId;
    } else if (workflow.status === 'verification_preset_2') {
      side = 'candidate';
      childSessionId = sessions.candidateSessionId;
    } else if (workflow.status === 'verification_finalize_required') {
      return { workflow, completed: true, nextAction: workflow.nextAction };
    } else {
      throw new Error(`verification cannot advance from parent status ${workflow.status}`);
    }
    const child = await this.verification.advance({ sessionId: childSessionId, ready });
    return this.syncAfterChild({ sessionId, workflow, side, childResult: child, eventType: 'verification.advanced' });
  }

  async resumeVerificationManual({ sessionId }) {
    const workflow = await this.theater.status(sessionId);
    const sessions = workflow.verificationSessions;
    if (!sessions) throw new Error('parent autotune session has no verification datasets');
    let side;
    let childSessionId;
    if (workflow.status === 'verification_preset_1') {
      side = 'baseline';
      childSessionId = sessions.baselineSessionId;
    } else if (workflow.status === 'verification_preset_2') {
      side = 'candidate';
      childSessionId = sessions.candidateSessionId;
    } else {
      throw new Error(`manual verification cannot resume from parent status ${workflow.status}`);
    }
    const child = await this.verification.resumeManual({ sessionId: childSessionId });
    return this.syncAfterChild({ sessionId, workflow, side, childResult: child, eventType: 'verification.manual-resumed' });
  }

  async finalizeVerification({ sessionId, minimumGain = 0.5, majorRegression = 8 }) {
    const workflow = await this.theater.status(sessionId);
    const sessions = workflow.verificationSessions;
    if (!sessions) throw new Error('parent autotune session has no verification datasets');
    if (workflow.status !== 'verification_finalize_required') {
      throw new Error(`measured verification can only finalize from verification_finalize_required, current status is ${workflow.status}`);
    }
    const result = await this.verification.finalize({
      baselineSessionId: sessions.baselineSessionId,
      candidateSessionId: sessions.candidateSessionId,
      reportSessionId: sessionId,
      minimumGain,
      majorRegression
    });
    if (!result.finalized) {
      workflow.nextAction = result.reason || 'Verification finalization is blocked. Resolve the evidence issue and retry.';
      await this.theater.saveWorkflow(sessionId, workflow, 'verification.finalize-blocked', {
        reason: result.reason || null
      });
      return { workflow, result, blocked: true, nextAction: workflow.nextAction };
    }
    workflow.status = result.status;
    workflow.phase = 'verification_complete';
    workflow.recommendedPreset = result.recommendedPreset;
    workflow.verification = {
      baselineSessionId: sessions.baselineSessionId,
      candidateSessionId: sessions.candidateSessionId,
      verificationPath: result.verificationPath,
      reportPath: result.reportPath,
      accepted: result.accepted,
      recommendedPreset: result.recommendedPreset
    };
    workflow.nextAction = result.nextAction;
    await this.theater.saveWorkflow(
      sessionId,
      workflow,
      result.accepted ? 'verification.accepted' : 'verification.rejected',
      {
        recommendedPreset: result.recommendedPreset,
        baselineScore: result.baseline?.score?.score ?? null,
        candidateScore: result.candidate?.score?.score ?? null,
        overallDelta: result.comparison?.overallDelta ?? null,
        gates: result.gates || []
      }
    );
    return { workflow, result, nextAction: workflow.nextAction };
  }
}
