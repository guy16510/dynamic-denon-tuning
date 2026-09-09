#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { EvoBurrowAdapter } from './adapters/evoburrow.js';
import { DenonAdapter } from './adapters/denon.js';
import { RewAdapter } from './adapters/rew.js';
import { ShieldAdapter } from './adapters/shield.js';
import { NexusAdapter } from './adapters/nexus.js';
import { SessionStore } from './lib/session-store.js';
import { MeasurementService } from './services/measurement-service.js';
import { TheaterService } from './services/theater-service.js';
import { HardwareProofService } from './services/hardware-proof-service.js';
import { scoreCalibration } from './calibration/score.js';
import { compareScores } from './calibration/compare.js';
import { crossoverCandidates, proposeDelayAdjustment } from './calibration/optimize.js';
import { serializeError } from './lib/errors.js';

const config = loadConfig();
const sessions = new SessionStore(config.sessionsDir);
const evoburrow = new EvoBurrowAdapter(config.evoburrow);
const denon = new DenonAdapter(config.denon, evoburrow);
const rew = new RewAdapter(config.rew, evoburrow);
const shield = new ShieldAdapter(config.shield);
const nexus = new NexusAdapter(config.nexus);
const measurement = new MeasurementService({ rew, shield, denon, sessions });
const theater = new TheaterService({ config, evoburrow, denon, rew, shield, nexus, measurement, sessions });
const hardwareProof = new HardwareProofService({ denon, rew, shield, measurement, sessions });

const server = new McpServer({
  name: 'denon-atmos-autotune',
  version: '0.2.0'
});

function response(data, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError
  };
}

function guarded(handler) {
  return async args => {
    try {
      return response(await handler(args || {}));
    } catch (error) {
      return response({ error: serializeError(error) }, true);
    }
  };
}

server.tool('theater_inspect', 'Read-only inspection of EvoBurrow, Denon, REW, Shield, preset state, and automation blockers.', {}, guarded(async () => theater.inspect()));

server.tool('theater_snapshot', 'Capture a read-only Denon baseline and optionally persist it inside an existing immutable calibration session.', {
  sessionId: z.string().optional()
}, guarded(async ({ sessionId }) => theater.snapshot(sessionId)));

server.tool('theater_prepare_measurement_state', 'Plan/apply the allowlisted Shield input, safe master volume, and unmute state through EvoBurrow. Writes remain disabled unless ALLOW_RECEIVER_WRITES=1 and confirm=true.', {
  confirm: z.boolean().default(false)
}, guarded(async ({ confirm }) => denon.prepareMeasurementState({ confirm })));

server.tool('theater_hardware_proof', 'Plan or run one evidence-backed Atmos channel proof through Shield -> Denon -> room -> mic -> REW. No audio is emitted unless confirmAudible=true.', {
  channel: z.string().default('TFL'),
  fileName: z.string(),
  stimulusPath: z.string(),
  confirmAudible: z.boolean().default(false)
}, guarded(async args => hardwareProof.run(args)));

server.tool('theater_hardware_proof_resume', 'Resume a hardware proof when REW requires a manually-started measurement. Start the prepared measurement in REW first; this call starts the Shield sweep and captures evidence.', {
  sessionId: z.string()
}, guarded(async ({ sessionId }) => hardwareProof.resume({ sessionId })));

server.tool('theater_set_distance', 'Request a speaker-distance/delay change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', {
  channel: z.string(),
  distanceMeters: z.number().min(0).max(18)
}, guarded(async ({ channel, distanceMeters }) => denon.setDistance(channel, distanceMeters)));

server.tool('theater_set_level', 'Request a channel trim change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', {
  channel: z.string(),
  trimDb: z.number().min(-12).max(6)
}, guarded(async ({ channel, trimDb }) => denon.setLevel(channel, trimDb)));

server.tool('theater_set_crossover', 'Request a crossover change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', {
  channel: z.string(),
  crossoverHz: z.number().min(40).max(250)
}, guarded(async ({ channel, crossoverHz }) => denon.setCrossover(channel, crossoverHz)));

server.tool('theater_autotune_start', 'Start a resumable full-theater calibration session. Captures preflight and baseline, protects Preset 1 by policy, and returns the first microphone-position action.', {
  positions: z.number().int().min(1).max(7).default(3),
  channels: z.array(z.string()).min(1).max(16).optional(),
  baselineAdy: z.string().optional(),
  sweepManifestPath: z.string().optional()
}, guarded(async ({ positions, channels, baselineAdy, sweepManifestPath }) => theater.startAutotune({ positions, ...(channels ? { channels } : {}), baselineAdy, sweepManifestPath })));

server.tool('theater_autotune_status', 'Read the persisted state of a calibration session.', {
  sessionId: z.string()
}, guarded(async ({ sessionId }) => theater.status(sessionId)));

server.tool('theater_autotune_advance', 'Advance a resumable calibration workflow after a microphone move, Nexus optimization, or MultEQ Editor transfer.', {
  sessionId: z.string(),
  ready: z.boolean().default(false),
  nexusComplete: z.boolean().default(false),
  optimizedAdy: z.string().optional(),
  uploadComplete: z.boolean().default(false)
}, guarded(async args => theater.advance(args)));

server.tool('theater_autotune_resume_manual', 'Resume a manually-started REW measurement. This call starts the matching Shield sweep, verifies Atmos, waits for the REW result, and persists evidence.', {
  sessionId: z.string()
}, guarded(async ({ sessionId }) => theater.resumeManualMeasurement({ sessionId })));

server.tool('theater_autotune_finalize_verification', 'Finalize a calibration only from measured baseline/candidate component scores. Rejects candidates with no aggregate gain, major regressions, or insufficient evidence.', {
  sessionId: z.string(),
  baselineMetrics: z.object({
    bassIntegration: z.number().min(0).max(100),
    crossoverIntegration: z.number().min(0).max(100),
    timing: z.number().min(0).max(100),
    frequencyResponse: z.number().min(0).max(100),
    channelConsistency: z.number().min(0).max(100),
    seatConsistency: z.number().min(0).max(100),
    headroom: z.number().min(0).max(100)
  }),
  candidateMetrics: z.object({
    bassIntegration: z.number().min(0).max(100),
    crossoverIntegration: z.number().min(0).max(100),
    timing: z.number().min(0).max(100),
    frequencyResponse: z.number().min(0).max(100),
    channelConsistency: z.number().min(0).max(100),
    seatConsistency: z.number().min(0).max(100),
    headroom: z.number().min(0).max(100)
  }),
  changes: z.array(z.record(z.any())).default([]),
  remainingIssues: z.array(z.union([z.string(), z.record(z.any())])).default([]),
  minimumGain: z.number().min(0).max(20).default(0.5),
  majorRegression: z.number().min(1).max(30).default(8)
}, guarded(async args => theater.finalizeVerification(args)));

server.tool('measurement_preflight', 'Check REW/Measure From File, live Denon input-volume-mute safety, Shield ADB connectivity, and automatic-measurement capability.', {}, guarded(async () => measurement.preflight()));

server.tool('measurement_measure_channel', 'Prepare REW Measure From File, verify live receiver safety, trigger the measurement when licensed, start the matching Shield sweep, verify Atmos, capture REW evidence, and persist the raw result.', {
  sessionId: z.string(),
  position: z.number().int().min(0).max(6),
  channel: z.string(),
  shieldFile: z.string(),
  stimulusPath: z.string(),
  title: z.string().optional(),
  notes: z.string().optional(),
  verifyAtmos: z.boolean().default(true)
}, guarded(async args => {
  const value = await measurement.measureChannel(args);
  if (!value.completed) return value;
  return {
    completed: true,
    path: value.path,
    measurement: {
      position: value.record.position,
      channel: value.record.channel,
      rewId: value.record.rewId,
      atmos: value.record.atmos,
      quality: value.record.quality,
      acceptedForOptimization: value.record.acceptedForOptimization,
      gate: value.record.gate
    }
  };
}));

server.tool('measurement_capture_new', 'Complete or adopt exactly one manual REW measurement and persist its evidence. When shieldFile is supplied, the server starts that encoded Shield sweep before waiting for the REW result.', {
  sessionId: z.string(),
  position: z.number().int().min(0).max(6),
  channel: z.string(),
  beforeMeasurementKeys: z.array(z.string()),
  shieldFile: z.string().optional()
}, guarded(async args => measurement.captureManual(args)));

server.tool('shield_status', 'Verify ADB connectivity to the NVIDIA Shield and report basic device information.', {}, guarded(async () => shield.status()));

server.tool('shield_list_sweeps', 'List allowlisted sweep filenames in a channel folder on the Shield.', {
  channel: z.string()
}, guarded(async ({ channel }) => ({ channel, files: await shield.listSweeps(channel) })));

server.tool('shield_play_sweep', 'Start one configured encoded sweep on the Shield. This does not change AVR settings.', {
  channel: z.string(),
  fileName: z.string()
}, guarded(async ({ channel, fileName }) => shield.playSweep(channel, fileName)));

server.tool('shield_stop', 'Stop/pause current Shield media playback.', {}, guarded(async () => shield.stop()));

server.tool('shield_verify_atmos', 'Read receiver status through EvoBurrow and poll briefly for evidence that the active decoder/status identifies Atmos.', {}, guarded(async () => denon.verifyAtmos()));

server.tool('rew_status', 'Read REW version, audio state, measurement modes, and negotiated command capability without changing anything.', {}, guarded(async () => rew.status()));

server.tool('rew_measurement_contract', 'Read REW-advertised command/playback/mode choices and verify the exact Measure From File contract this project will use.', {}, guarded(async () => rew.measurementContract()));

server.tool('rew_input_level_check', 'Run EvoBurrow bounded microphone input-level capture. Requires confirm=true because it starts capture, but emits no sweep.', {
  durationMs: z.number().int().min(1000).max(15000).default(4000),
  confirm: z.boolean().default(false)
}, guarded(async args => rew.inputLevelCheck(args)));

server.tool('calibration_score', 'Calculate the transparent weighted calibration score from measured component metrics. Missing metrics lower confidence.', {
  metrics: z.object({
    bassIntegration: z.number().min(0).max(100).optional(),
    crossoverIntegration: z.number().min(0).max(100).optional(),
    timing: z.number().min(0).max(100).optional(),
    frequencyResponse: z.number().min(0).max(100).optional(),
    channelConsistency: z.number().min(0).max(100).optional(),
    seatConsistency: z.number().min(0).max(100).optional(),
    headroom: z.number().min(0).max(100).optional()
  })
}, guarded(async ({ metrics }) => scoreCalibration(metrics)));

server.tool('calibration_compare_scores', 'Apply the acceptance rule: measured aggregate improvement plus no major component regression.', {
  baselineMetrics: z.record(z.number()),
  candidateMetrics: z.record(z.number()),
  minimumGain: z.number().min(0).max(20).default(0.5),
  majorRegression: z.number().min(1).max(30).default(8)
}, guarded(async ({ baselineMetrics, candidateMetrics, minimumGain, majorRegression }) => {
  const baseline = scoreCalibration(baselineMetrics);
  const candidate = scoreCalibration(candidateMetrics);
  return { baseline, candidate, comparison: compareScores(baseline, candidate, { minimumGain, majorRegression }) };
}));

server.tool('calibration_crossover_candidates', 'Generate bounded crossover candidates from measured speaker extension. These are proposals only and require real summed-response verification.', {
  f3Hz: z.number().positive().optional(),
  currentHz: z.number().positive().optional(),
  role: z.string().default('speaker')
}, guarded(async args => ({ candidatesHz: crossoverCandidates(args), rule: 'Test and re-measure each candidate, do not accept from prediction alone.' })));

server.tool('calibration_delay_candidate', 'Translate measured arrival-time offset into a candidate AVR distance/delay adjustment. Proposal only.', {
  measuredOffsetMs: z.number(),
  currentDistanceMeters: z.number().min(0).max(18)
}, guarded(async args => proposeDelayAdjustment(args)));

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await evoburrow.close().catch(() => {});
    process.exit(0);
  });
}
