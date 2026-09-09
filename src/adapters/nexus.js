import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { run } from '../lib/process.js';
import { CapabilityError } from '../lib/errors.js';

export class NexusAdapter {
  constructor(config) {
    this.config = config;
  }

  async prepare({ sessionRoot, baselineAdy, measurements, rewMdat = null, targetCurve = null }) {
    if (!baselineAdy) throw new Error('baselineAdy is required');
    await access(baselineAdy, constants.R_OK);
    const root = join(sessionRoot, 'nexus');
    await mkdir(root, { recursive: true });
    const inputPath = join(root, 'input.ady');
    try {
      await access(inputPath, constants.F_OK);
      throw new Error('refusing to overwrite Nexus input.ady in an existing session');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await copyFile(resolve(baselineAdy), inputPath);
    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      baselineAdy: inputPath,
      measurements,
      rewMdat,
      targetCurve,
      rule: 'A1/Nexus owns XT32 optimization. This orchestrator does not implement a replacement FIR optimizer.'
    };
    const manifestPath = join(root, 'handoff.json');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { prepared: true, root, inputPath, manifestPath, interactiveRequired: !this.config.command };
  }

  async optimize({ manifestPath }) {
    if (!this.config.command) {
      return {
        automated: false,
        interactiveRequired: true,
        manifestPath,
        instruction: 'Open A1 Evo Nexus, use the prepared baseline and REW measurements, run Optimize Calibration, then place optimized.ady in the session nexus directory.'
      };
    }
    const [command, ...prefixArgs] = this.config.command.split(/\s+/).filter(Boolean);
    if (!command) throw new CapabilityError('NEXUS_COMMAND is empty');
    const result = await run(command, [...prefixArgs, manifestPath], { timeoutMs: 30 * 60 * 1000 });
    return { automated: true, stdout: result.stdout, stderr: result.stderr };
  }

  async validateOptimized(path) {
    if (!path || basename(path).toLowerCase() !== 'optimized.ady') {
      throw new Error('optimized calibration must be named optimized.ady');
    }
    await access(path, constants.R_OK);
    return { valid: true, path: resolve(path) };
  }
}
