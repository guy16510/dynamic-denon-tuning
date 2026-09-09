import { mkdir, readFile, writeFile, access, copyFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

function idNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
}

export class SessionStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
  }

  async create(metadata = {}) {
    await mkdir(this.rootDir, { recursive: true });
    const id = `${idNow()}-${Math.random().toString(36).slice(2, 8)}`;
    const root = join(this.rootDir, id);
    for (const dir of ['baseline', 'measurements', 'rew', 'nexus', 'optimized', 'events']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await this.writeJson(id, 'session.json', {
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      status: 'created',
      ...metadata
    });
    return { id, root };
  }

  path(sessionId, relativePath) {
    const root = resolve(this.rootDir, sessionId);
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('session path escapes session root');
    return target;
  }

  async writeJson(sessionId, relativePath, value, { overwrite = false } = {}) {
    const path = this.path(sessionId, relativePath);
    await mkdir(resolve(path, '..'), { recursive: true });
    if (!overwrite) {
      try {
        await access(path, constants.F_OK);
        throw new Error(`refusing to overwrite session artifact: ${relativePath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return path;
  }

  async readJson(sessionId, relativePath) {
    return JSON.parse(await readFile(this.path(sessionId, relativePath), 'utf8'));
  }

  async readMeasurementRecords(sessionId) {
    const measurementRoot = this.path(sessionId, 'measurements');
    const positions = await readdir(measurementRoot, { withFileTypes: true });
    const records = [];
    for (const position of positions.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const directory = join(measurementRoot, position.name);
      const files = await readdir(directory, { withFileTypes: true });
      for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
        records.push(JSON.parse(await readFile(join(directory, file.name), 'utf8')));
      }
    }
    return records;
  }

  async appendEvent(sessionId, type, data = {}) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return this.writeJson(sessionId, `events/${stamp}.json`, {
      at: new Date().toISOString(),
      type,
      data
    });
  }

  async copyArtifact(sessionId, sourcePath, relativePath) {
    const destination = this.path(sessionId, relativePath);
    await mkdir(resolve(destination, '..'), { recursive: true });
    try {
      await access(destination, constants.F_OK);
      throw new Error(`refusing to overwrite session artifact: ${relativePath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await copyFile(sourcePath, destination);
    return destination;
  }
}
