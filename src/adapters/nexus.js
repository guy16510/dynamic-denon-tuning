import { mkdir, writeFile, copyFile, access, stat } from 'node:fs/promises';
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
    const baseline = await stat(baselineAdy);
    if (!baseline.isFile() || baseline.size <= 0) throw new Error('baselineAdy must be a non-empty file');
    const root = join(sessionRoot, 'nexus');
    await mkdir(root, { recursive: true });
    const inputPath = join(root, 'input.ady');
    const manifestPath = join(root, 'handoff.json');
    for (const path of [inputPath, manifestPath]) {
      try {
        await access(path, constants.F_OK);
        throw new Error(`refusing to overwrite Nexus session artifact: ${basename(path)}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await copyFile(resolve(baselineAdy), inputPath, constants.COPYFILE_EXCL);
    const manifest = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      baselineAdy: inputPath,
      baselineBytes: baseline.size,
      measurements,
      rewMdat,
      targetCurve,
      rule: 'A1/Nexus owns XT32 optimization. This orchestrator does not implement a replacement FIR optimizer.'
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
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
    const resolved = resolve(path);
    let file;
    try {
      file = await stat(resolved);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`optimized calibration does not exist: ${resolved}`);
      throw error;
    }
    if (!file.isFile()) throw new Error('optimized calibration must be a regular file');
    if (file.size <= 0) throw new Error('optimized calibration is empty');
    return {
      valid: true,
      path: resolved,
      size: file.size,
      validationScope: 'File identity/readability/non-empty validation only. V1 does not reverse-engineer the proprietary .ady format.'
    };
  }
}
