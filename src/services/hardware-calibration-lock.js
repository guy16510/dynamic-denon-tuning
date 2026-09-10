import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export class HardwareCalibrationLock {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.path = join(rootDir, '.hardware-calibration.lock');
  }

  async acquire(sessionId) {
    await mkdir(this.rootDir, { recursive: true });
    try {
      const handle = await open(this.path, 'wx');
      await handle.writeFile(`${JSON.stringify({ sessionId, acquiredAt: new Date().toISOString() })}\n`);
      await handle.close();
      return { acquired: true, sessionId };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(await readFile(this.path, 'utf8')); } catch {}
      if (owner?.sessionId === sessionId) return { acquired: true, sessionId, alreadyOwned: true };
      return { acquired: false, owner };
    }
  }

  async release(sessionId) {
    try {
      const owner = JSON.parse(await readFile(this.path, 'utf8'));
      if (owner.sessionId !== sessionId) return false;
      await unlink(this.path);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
