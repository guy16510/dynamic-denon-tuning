import { mkdir, readFile, writeFile, access, copyFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';

function idNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_');
}

export class SessionStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
  }

  async create(metadata = {}) {
    await mkdir(this.rootDir, { recursive: true });
    const id = `${idNow()}-${Math.random().toString(36).slice(2, 8)}`;
    const root = join(this.rootDir, id);
    for (const dir of ['baseline', 'measurements', 'rew', 'nexus', 'optimized', 'verification', 'events']) {
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

  async allocateMeasurementAttempt(sessionId, { position, channel, rewId }) {
    const directory = `measurements/position-${position}/${safeId(channel)}`;
    const root = this.path(sessionId, directory);
    await mkdir(root, { recursive: true });
    const files = await readdir(root, { withFileTypes: true }).catch(() => []);
    const attempts = files
      .filter(entry => entry.isFile() && /^attempt-\d{3}-.*\.json$/.test(entry.name))
      .map(entry => Number(entry.name.slice(8, 11)))
      .filter(Number.isFinite);
    const number = (attempts.length ? Math.max(...attempts) : 0) + 1;
    const fileName = `attempt-${String(number).padStart(3, '0')}-${safeId(rewId)}.json`;
    return { number, relativePath: `${directory}/${fileName}`, directory };
  }

  async acceptMeasurementAttempt(sessionId, recordPath, record) {
    const pointerPath = `measurements/position-${record.position}/${safeId(record.channel)}/accepted.json`;
    const pointer = {
      schemaVersion: 1,
      acceptedAt: new Date().toISOString(),
      position: record.position,
      channel: record.channel,
      rewId: record.rewId,
      attempt: record.attempt,
      recordPath
    };
    await this.writeJson(sessionId, pointerPath, pointer, { overwrite: true });
    return { pointerPath, pointer };
  }

  async resolveAcceptedMeasurement(sessionId, position, channel) {
    const pointerPath = `measurements/position-${position}/${safeId(channel)}/accepted.json`;
    const pointer = await this.readJson(sessionId, pointerPath);
    const record = await this.readJson(sessionId, pointer.recordPath);
    return { pointerPath, pointer, record };
  }

  async readMeasurementRecords(sessionId, { acceptedOnly = false } = {}) {
    const measurementRoot = this.path(sessionId, 'measurements');
    const positions = await readdir(measurementRoot, { withFileTypes: true }).catch(() => []);
    const records = [];
    for (const position of positions.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const positionDir = join(measurementRoot, position.name);
      const entries = await readdir(positionDir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          records.push(JSON.parse(await readFile(join(positionDir, entry.name), 'utf8')));
          continue;
        }
        if (!entry.isDirectory()) continue;
        const channelDir = join(positionDir, entry.name);
        if (acceptedOnly) {
          try {
            const pointer = JSON.parse(await readFile(join(channelDir, 'accepted.json'), 'utf8'));
            records.push(JSON.parse(await readFile(this.path(sessionId, pointer.recordPath), 'utf8')));
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          continue;
        }
        const files = await readdir(channelDir, { withFileTypes: true });
        for (const file of files.filter(item => item.isFile() && /^attempt-.*\.json$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
          records.push(JSON.parse(await readFile(join(channelDir, file.name), 'utf8')));
        }
      }
    }
    return records;
  }

  async readMeasurementHistory(sessionId) {
    const records = await this.readMeasurementRecords(sessionId);
    return records.sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));
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
