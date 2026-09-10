import test from 'node:test';
import assert from 'node:assert/strict';
import { ShieldAdapter } from '../src/adapters/shield.js';

function config() {
  return {
    host: '192.168.2.20',
    adbPath: 'adb',
    sweepDir: '/sdcard/Movies/AtmosCalibration',
    playerComponent: null
  };
}

function successfulRunner(calls) {
  return async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'connect') return { stdout: 'connected', stderr: '', code: 0 };
    if (args.length === 1 && args[0] === 'devices') return { stdout: 'List of devices attached\n192.168.2.20:5555\tdevice', stderr: '', code: 0 };
    if (args.includes('test') && args.includes('-f')) return { stdout: '', stderr: '', code: 0 };
    if (args.includes('am') && args.includes('start')) return { stdout: 'Status: ok\nActivity: player', stderr: '', code: 0 };
    return { stdout: '', stderr: '', code: 0 };
  };
}

test('playSweep verifies exact remote file immediately before Android launch', async () => {
  const calls = [];
  const shield = new ShieldAdapter(config(), successfulRunner(calls));
  const result = await shield.playSweep('TFL', 'TFL.wav');
  assert.equal(result.fileVerified, true);
  assert.equal(result.launchRequested, true);
  const fileCheck = calls.find(([, args]) => args.includes('test') && args.includes('-f'));
  const launch = calls.find(([, args]) => args.includes('am') && args.includes('start'));
  assert.ok(fileCheck);
  assert.ok(launch);
  assert.ok(calls.indexOf(fileCheck) < calls.indexOf(launch));
  assert.ok(launch[1].includes('-W'));
  assert.match(result.caveat, /not acoustic proof/i);
});

test('playSweep blocks before Android launch when exact remote file is missing', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'connect') return { stdout: 'connected', stderr: '', code: 0 };
    if (args.length === 1 && args[0] === 'devices') return { stdout: 'List of devices attached\n192.168.2.20:5555\tdevice', stderr: '', code: 0 };
    if (args.includes('test') && args.includes('-f')) throw new Error('adb exited 1');
    if (args.includes('am') && args.includes('start')) throw new Error('launch must not occur');
    return { stdout: '', stderr: '', code: 0 };
  };
  const shield = new ShieldAdapter(config(), runner);
  await assert.rejects(() => shield.playSweep('TFL', 'TFL.wav'), /does not exist immediately before playback/);
  assert.equal(calls.some(([, args]) => args.includes('am') && args.includes('start')), false);
});

test('remote sweep path rejects traversal in channel and filename', () => {
  const shield = new ShieldAdapter(config(), async () => ({ stdout: '', stderr: '', code: 0 }));
  assert.throws(() => shield.remotePath('../TFL', 'TFL.wav'), /invalid channel/);
  assert.throws(() => shield.remotePath('TFL', '../TFL.wav'), /invalid sweep filename/);
});
