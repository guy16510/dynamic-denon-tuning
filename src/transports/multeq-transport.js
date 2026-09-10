export class MultEqTransport {
  async status() { throw new Error('MultEqTransport.status must be implemented'); }
  async transfer() { throw new Error('MultEqTransport.transfer must be implemented'); }
}

export class ManualMultEqTransport extends MultEqTransport {
  async status() {
    return { mode: 'manual', automated: false, resumable: true };
  }

  async transfer({ candidatePath, targetPreset = 2 }) {
    if (!candidatePath) throw new Error('candidatePath is required');
    if (targetPreset !== 2) throw new Error('V2 candidate transfer is restricted to protected candidate Preset 2');
    return {
      complete: false,
      checkpoint: true,
      candidatePath,
      targetPreset,
      instruction: 'Import the candidate .ady with MultEQ Editor and transfer it to Speaker Preset 2, then resume after receiver state is verified.'
    };
  }
}
