import { basename, posix } from 'node:path';
import { run } from '../lib/process.js';
import { CapabilityError } from '../lib/errors.js';

const CHANNEL_RE = /^[A-Z0-9_-]{1,12}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;

export class ShieldAdapter {
  constructor(config, runCommand = run) {
    this.config = config;
    this.runCommand = runCommand;
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
    await this.runCommand(this.config.adbPath, ['connect', `${this.config.host}:5555`], { timeoutMs: 10000 });
    const devices = await this.runCommand(this.config.adbPath, ['devices'], { timeoutMs: 5000 });
    const connected = devices.stdout.split(/\r?\n/).some(line => line.startsWith(`${this.config.host}:5555\tdevice`));
    if (!connected) throw new Error(`Shield ${this.config.host}:5555 is not authorized/connected over ADB`);
    return { connected: true, host: this.config.host, devices: devices.stdout };
  }

  async status() {
    await this.ensureConnected();
    const [model, sdk] = await Promise.all([
      this.runCommand(this.config.adbPath, this.adbArgs('shell', 'getprop', 'ro.product.model')),
      this.runCommand(this.config.adbPath, this.adbArgs('shell', 'getprop', 'ro.build.version.sdk'))
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
    const result = await this.runCommand(this.config.adbPath, this.adbArgs('shell', 'ls', '-1', path));
    return result.stdout.split(/\r?\n/).filter(Boolean).filter(name => FILE_RE.test(name));
  }

  async assertSweepExists(channel, fileName) {
    await this.ensureConnected();
    const remote = this.remotePath(channel, fileName);
    try {
      await this.runCommand(this.config.adbPath, this.adbArgs('shell', 'test', '-f', remote), { timeoutMs: 5000 });
    } catch (error) {
      throw new CapabilityError(`Shield sweep does not exist immediately before playback: ${remote}`, {
        channel,
        fileName,
        remote,
        cause: error.message
      });
    }
    return { exists: true, channel, fileName, remote };
  }

  async playSweep(channel, fileName) {
    const verified = await this.assertSweepExists(channel, fileName);
    const uri = `file://${verified.remote}`;
    const args = this.config.playerComponent
      ? this.adbArgs('shell', 'am', 'start', '-W', '-n', this.config.playerComponent, '-a', 'android.intent.action.VIEW', '-d', uri)
      : this.adbArgs('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', uri, '-t', 'audio/*');
    const result = await this.runCommand(this.config.adbPath, args, { timeoutMs: 10000 });
    return {
      started: true,
      launchRequested: true,
      fileVerified: true,
      channel,
      fileName,
      remote: verified.remote,
      adb: result.stdout,
      caveat: 'Android activity launch success is not acoustic proof. Atmos decoder evidence plus a valid REW measurement are still required.'
    };
  }

  async stop() {
    await this.ensureConnected();
    await this.runCommand(this.config.adbPath, this.adbArgs('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_STOP')).catch(async () => {
      await this.runCommand(this.config.adbPath, this.adbArgs('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE'));
    });
    return { stopped: true };
  }
}
