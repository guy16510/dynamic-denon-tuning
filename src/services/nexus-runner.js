export class NexusRunner {
  constructor(nexus) { this.nexus = nexus; }

  async run(input) {
    const prepared = await this.nexus.prepare(input);
    const optimized = await this.nexus.optimize({ manifestPath: prepared.manifestPath });
    return {
      prepared,
      optimized,
      checkpoint: optimized.interactiveRequired === true,
      rule: 'Nexus remains the Audyssey/XT32 optimization owner. Interactive work is represented as a resumable checkpoint rather than bypassed.'
    };
  }
}
