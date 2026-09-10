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

function inputToken(value) {
  const token = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9/+-]{1,20}$/.test(token)) throw new Error('DENON_SHIELD_INPUT must be a Denon protocol input token such as MPLAY, GAME, AUX1, or BD');
  return token;
}

export function loadConfig() {
  const volumeDb = numberEnv('AUTOTUNE_MEASUREMENT_VOLUME_DB', -30);
  if (volumeDb < -60 || volumeDb > -15) throw new Error('AUTOTUNE_MEASUREMENT_VOLUME_DB must be between -60 and -15 dB');

  const rewMode = (process.env.REW_MEASUREMENT_MODE || 'auto').toLowerCase();
  if (!['auto', 'pro', 'manual'].includes(rewMode)) throw new Error('REW_MEASUREMENT_MODE must be auto, pro, or manual');
  const filePlaybackArmDelayMs = numberEnv('REW_FILE_PLAYBACK_ARM_DELAY_MS', 4000);
  if (!Number.isInteger(filePlaybackArmDelayMs) || filePlaybackArmDelayMs < 1000 || filePlaybackArmDelayMs > 15000) throw new Error('REW_FILE_PLAYBACK_ARM_DELAY_MS must be an integer between 1000 and 15000 ms');

  const dashboardPort = numberEnv('DASHBOARD_PORT', 3700);
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) throw new Error('DASHBOARD_PORT must be an integer between 1 and 65535');
  const nativeMeasurement = (process.env.DENON_NATIVE_MEASUREMENT || 'probe').toLowerCase();
  if (!['off', 'probe'].includes(nativeMeasurement)) throw new Error('DENON_NATIVE_MEASUREMENT must be off or probe until hardware validation graduates the capability');

  return Object.freeze({
    denon: {
      host: process.env.DENON_HOST || '192.168.2.8',
      port: numberEnv('DENON_PORT', 23),
      shieldInput: inputToken(process.env.DENON_SHIELD_INPUT || 'MPLAY'),
      measurementVolumeDb: volumeDb,
      allowWrites: boolEnv('ALLOW_RECEIVER_WRITES', false)
    },
    evoburrow: { serverPath: process.env.EVOBURROW_SERVER || null, home: process.env.A1_EVO_HOME || null },
    shield: {
      host: process.env.SHIELD_HOST || null,
      adbPath: process.env.ADB_PATH || 'adb',
      sweepDir: process.env.SHIELD_SWEEP_DIR || '/sdcard/Movies/AtmosCalibration',
      playerComponent: process.env.SHIELD_PLAYER_COMPONENT || null
    },
    rew: { url: process.env.REW_URL || 'http://127.0.0.1:4735', measurementMode: rewMode, filePlaybackArmDelayMs },
    nexus: { workspace: process.env.NEXUS_WORKSPACE || null, command: process.env.NEXUS_COMMAND || null },
    dashboard: { host: process.env.DASHBOARD_HOST || '127.0.0.1', port: dashboardPort },
    calibration: {
      profilePath: resolve(process.cwd(), process.env.CALIBRATION_PROFILE || 'profiles/reference-home-theater.json'),
      nativeMeasurement
    },
    sessionsDir: resolve(process.cwd(), process.env.SESSIONS_DIR || 'sessions')
  });
}
