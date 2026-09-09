import { resolve } from 'node:path';

function numberEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export function loadConfig() {
  const volumeDb = numberEnv('AUTOTUNE_MEASUREMENT_VOLUME_DB', -30);
  if (volumeDb < -60 || volumeDb > -15) {
    throw new Error('AUTOTUNE_MEASUREMENT_VOLUME_DB must be between -60 and -15 dB');
  }

  const rewMode = (process.env.REW_MEASUREMENT_MODE || 'auto').toLowerCase();
  if (!['auto', 'pro', 'manual'].includes(rewMode)) {
    throw new Error('REW_MEASUREMENT_MODE must be auto, pro, or manual');
  }

  return Object.freeze({
    denon: {
      host: process.env.DENON_HOST || '192.168.2.8',
      port: numberEnv('DENON_PORT', 23),
      shieldInput: process.env.DENON_SHIELD_INPUT || 'MEDIA PLAYER',
      measurementVolumeDb: volumeDb,
      allowWrites: boolEnv('ALLOW_RECEIVER_WRITES', false)
    },
    evoburrow: {
      serverPath: process.env.EVOBURROW_SERVER || null,
      home: process.env.A1_EVO_HOME || null
    },
    shield: {
      host: process.env.SHIELD_HOST || null,
      adbPath: process.env.ADB_PATH || 'adb',
      sweepDir: process.env.SHIELD_SWEEP_DIR || '/sdcard/Movies/AtmosCalibration',
      playerComponent: process.env.SHIELD_PLAYER_COMPONENT || null
    },
    rew: {
      url: process.env.REW_URL || 'http://127.0.0.1:4735',
      measurementMode: rewMode
    },
    nexus: {
      workspace: process.env.NEXUS_WORKSPACE || null,
      command: process.env.NEXUS_COMMAND || null
    },
    sessionsDir: resolve(process.cwd(), process.env.SESSIONS_DIR || 'sessions')
  });
}
