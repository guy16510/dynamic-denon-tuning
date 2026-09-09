import { basename, posix } from 'node:path';
import { run } from '../lib/process.js';
import { CapabilityError } from '../lib/errors.js';

const CHANNEL_RE = /^[A-Z0-9_-]{1,12}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;

export class ShieldAdapter {
  constructor(config) {
    this.config = config;
  }

  assertConfigured() {
    if (!this.config.host) {
      throw new CapabilityError('SHIELD_HOST is not configured', {
        remediation: 'Enable network debugging on the Shield and set SHIELD_HOST.'
      });
    }
  }

  adbArgs(...args) {
    this.assertConfigured();
    return ['-s', `${this.config.host}:5555`, ...args];
  }

  async ensureConnected() {
    this.assertConfigured();
    await run(this.config.adbPath, ['connect', `${this.config.host}:5555`], { timeoutMs: 10000 });
    const devices = await run(this.config.adbPath, ['devices'], { timeoutMs: 5000 });
    const connected = devices.stdout.split(/\r?\n/).some(line => line.startsWith(`${this.config.host}:5555\tdevice`));
    if (!connected) throw new Error(`Shield ${this.config.host}:5555 is not authorized/connected over ADB`);
    return { connected: true, host: this.config.host, devices: devices.stdout };
  }

  async status() {
    await this.ensureConnected();
    const [model, sdk] = await Promise.all([
      run(this.config.adbPath, this.adbArgs('shell', 'getprop', 'ro.product.model')),
      run(this.config.adbPath, this.adbArgs('shell', 'getprop', 'ro.build.version.sdk'))
    ]);
    return { connected: true, model: model.stdout, sdk: sdk.stdout, sweepDir: this.config.sweepDir };
  }

  remotePath(channel, fileName) {
    if (!CHANNEL_RE.test(channel)) throw new Error('invalid channel identifier');
    if (!FILE_RE.test(fileName) || basename(fileName) !== fileName) throw new Error('invalid sweep filename');
    return posix.join(this.config.sweepDir, channel, fileName);
  }

  async listSweeps(channel) {
    if (!CHANNEL_RE.test(channel)) throw new Error('invalid channel identifier');
    await this.ensureConnected();
    const path = posix.join(this.config.sweepDir, channel);
    const result = await run(this.config.adbPath, this.adbArgs('shell', 'ls', '-1', path));
    return result.stdout.split(/\r?\n/).filter(Boolean).filter(name => FILE_RE.test(name));
  }

  async playSweep(channel, fileName) {
    await this.ensureConnected();
    const remote = this.remotePath(channel, fileName);
    const uri = `file://${remote}`;
    const args = this.config.playerComponent
      ? this.adbArgs('shell', 'am', 'start', '-n', this.config.playerComponent, '-a', 'android.intent.action.VIEW', '-d', uri)
      : this.adbArgs('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', uri, '-t', 'audio/*');
    const result = await run(this.config.adbPath, args, { timeoutMs: 10000 });
    return { started: true, channel, fileName, remote, adb: result.stdout };
  }

  async stop() {
    await this.ensureConnected();
    await run(this.config.adbPath, this.adbArgs('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_STOP')).catch(async () => {
      await run(this.config.adbPath, this.adbArgs('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE'));
    });
    return { stopped: true };
  }
}
