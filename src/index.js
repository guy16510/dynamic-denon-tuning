#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { EvoBurrowAdapter } from './adapters/evoburrow.js';
import { DenonAdapter } from './adapters/denon.js';
import { RewV2Adapter } from './adapters/rew-v2.js';
import { ShieldAdapter } from './adapters/shield.js';
import { NexusAdapter } from './adapters/nexus.js';
import { SessionStore } from './lib/session-store.js';
import { MeasurementService } from './services/measurement-service.js';
import { TheaterService } from './services/theater-service.js';
import { HardwareProofService } from './services/hardware-proof-service.js';
import { VerificationService } from './services/verification-service.js';
import { AutotuneOrchestrator } from './services/autotune-orchestrator.js';
import { LiveEventBus } from './services/live-event-bus.js';
import { V2EventStore } from './services/v2-event-store.js';
import { CalibrationStateMachine } from './services/calibration-state-machine.js';
import { CalibrationV2Service } from './services/calibration-v2-service.js';
import { NativeMeasurementProbeService } from './services/native-measurement-probe-service.js';
import { AudysseyRewImportService } from './services/audyssey-rew-import-service.js';
import { scoreCalibration, DEFAULT_WEIGHTS } from './calibration/score.js';
import { compareScores } from './calibration/compare.js';
import { deriveCalibrationMetrics } from './calibration/derive-metrics.js';
import { detectTopology } from './calibration/topology.js';
import { validateMatchedCoverage, finalizeMeasuredComparison } from './calibration/verification.js';
import { crossoverCandidates, proposeDelayAdjustment } from './calibration/optimize.js';
import { serializeError } from './lib/errors.js';
import { registerV2Tools } from './mcp/register-v2-tools.js';

const config = loadConfig();
const sessions = new SessionStore(config.sessionsDir);
const evoburrow = new EvoBurrowAdapter(config.evoburrow);
const denon = new DenonAdapter(config.denon, evoburrow);
const rew = new RewV2Adapter(config.rew, evoburrow);
const shield = new ShieldAdapter(config.shield);
const nexus = new NexusAdapter(config.nexus);
const measurement = new MeasurementService({ rew, shield, denon, sessions });
const theater = new TheaterService({ config, evoburrow, denon, rew, shield, nexus, measurement, sessions });
const hardwareProof = new HardwareProofService({ denon, rew, shield, measurement, sessions });
const verification = new VerificationService({ denon, measurement, sessions });
const autotune = new AutotuneOrchestrator({ theater, verification });
const v2Bus = new LiveEventBus();
const v2Events = new V2EventStore({ sessions, bus: v2Bus });
const v2StateMachine = new CalibrationStateMachine({ events: v2Events });
const v2Calibration = new CalibrationV2Service({ config, sessions, events: v2Events, stateMachine: v2StateMachine, theater, denon, shield });
const nativeProbe = new NativeMeasurementProbeService({ config, sessions });
const audysseyRewImport = new AudysseyRewImportService(rew);

const server = new McpServer({ name: 'denon-atmos-autotune', version: '0.5.0' });

function response(data, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError };
}

function guarded(handler) {
  return async args => {
    try { return response(await handler(args || {})); }
    catch (error) { return response({ error: serializeError(error) }, true); }
  };
}

async function deriveSessionEvidence(sessionId) {
  const records = await sessions.readMeasurementRecords(sessionId, { acceptedOnly: true });
  const derived = deriveCalibrationMetrics(records);
  const score = scoreCalibration(derived.metrics);
  return { sessionId, records: records.length, derived, score };
}

function missingDerivedMetrics(derived) {
  return Object.keys(DEFAULT_WEIGHTS).filter(name => !Number.isFinite(derived?.metrics?.[name]));
}

// V1 surface remains available for existing MCP clients.
server.tool('theater_inspect', 'Read-only inspection of EvoBurrow, Denon, REW, Shield, active topology, preset state, and automation blockers.', {}, guarded(async () => theater.inspect()));
server.tool('theater_detect_topology', 'Normalize active speaker channels from read-only Denon/EvoBurrow inspection. If detection is ambiguous, supply explicit channels. Protected topology settings are never written.', { channels: z.array(z.string()).min(1).max(20).optional() }, guarded(async ({ channels }) => detectTopology(await denon.inspect(), channels || null)));
server.tool('theater_snapshot', 'Capture a read-only Denon baseline and optionally persist it inside an existing immutable calibration session.', { sessionId: z.string().optional() }, guarded(async ({ sessionId }) => theater.snapshot(sessionId)));
server.tool('theater_prepare_measurement_state', 'Plan/apply the allowlisted Shield input, safe master volume, and unmute state through EvoBurrow. Writes remain disabled unless ALLOW_RECEIVER_WRITES=1 and confirm=true.', { confirm: z.boolean().default(false) }, guarded(async ({ confirm }) => denon.prepareMeasurementState({ confirm })));
server.tool('theater_hardware_proof', 'Plan or run one evidence-backed Atmos channel proof through Shield -> Denon -> room -> mic -> REW. No audio is emitted unless every preflight gate passes and confirmAudible=true.', { channel: z.string().default('TFL'), fileName: z.string(), stimulusPath: z.string(), expectedPreset: z.number().int().min(1).max(2).default(1), confirmAudible: z.boolean().default(false) }, guarded(async args => hardwareProof.run(args)));
server.tool('theater_hardware_proof_resume', 'Resume a hardware proof when REW requires a manually-started measurement. Preset state and live receiver safety are re-checked before the Shield sweep starts.', { sessionId: z.string() }, guarded(async ({ sessionId }) => hardwareProof.resume({ sessionId })));
server.tool('theater_set_distance', 'Request a speaker-distance/delay change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', { channel: z.string(), distanceMeters: z.number().min(0).max(18) }, guarded(async ({ channel, distanceMeters }) => denon.setDistance(channel, distanceMeters)));
server.tool('theater_set_level', 'Request a channel trim change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', { channel: z.string(), trimDb: z.number().min(-12).max(6) }, guarded(async ({ channel, trimDb }) => denon.setLevel(channel, trimDb)));
server.tool('theater_set_crossover', 'Request a crossover change. Fails closed until EvoBurrow exposes a baseline-bound allowlisted implementation.', { channel: z.string(), crossoverHz: z.number().min(40).max(250) }, guarded(async ({ channel, crossoverHz }) => denon.setCrossover(channel, crossoverHz)));
server.tool('theater_autotune_start', 'Start a resumable full-theater calibration session. Topology is detected read-only or must be supplied explicitly. Preset 1 is protected.', { positions: z.number().int().min(1).max(7).default(3), channels: z.array(z.string()).min(1).max(20).optional(), baselineAdy: z.string().optional(), sweepManifestPath: z.string().optional() }, guarded(async ({ positions, channels, baselineAdy, sweepManifestPath }) => theater.startAutotune({ positions, channels: channels || null, baselineAdy, sweepManifestPath })));
server.tool('theater_autotune_status', 'Read the persisted state of a calibration session.', { sessionId: z.string() }, guarded(async ({ sessionId }) => theater.status(sessionId)));
server.tool('theater_autotune_advance', 'Advance a resumable calibration workflow after a microphone move, measurement retry, Nexus optimization, or MultEQ Editor transfer.', { sessionId: z.string(), ready: z.boolean().default(false), nexusComplete: z.boolean().default(false), optimizedAdy: z.string().optional(), uploadComplete: z.boolean().default(false) }, guarded(async args => theater.advance(args)));
server.tool('theater_autotune_resume_manual', 'Resume a manually-started REW measurement. The preset and receiver safety are re-checked before Shield playback.', { sessionId: z.string() }, guarded(async ({ sessionId }) => theater.resumeManualMeasurement({ sessionId })));
server.tool('theater_autotune_begin_verification', 'Create the parent autotune session matched Preset 1/Preset 2 verification datasets using the exact original positions, channels, topology and sweep manifest. Idempotent.', { sessionId: z.string() }, guarded(async args => autotune.beginVerification(args)));
server.tool('theater_autotune_advance_verification', 'Advance the parent-owned verification workflow in order: Preset 1 first, then Preset 2. Wrong preset or missing evidence blocks audio and returns a human checkpoint.', { sessionId: z.string(), ready: z.boolean().default(false) }, guarded(async args => autotune.advanceVerification(args)));
server.tool('theater_autotune_resume_verification_manual', 'Resume the parent-owned manually-started REW verification measurement while preserving negotiated measurement settings and preset identity.', { sessionId: z.string() }, guarded(async args => autotune.resumeVerificationManual(args)));
server.tool('theater_autotune_finalize_measured', 'Finalize the parent autotune workflow exclusively from its matched immutable Preset 1/Preset 2 evidence and write the recommended preset back to the parent session.', { sessionId: z.string(), minimumGain: z.number().min(0).max(20).default(0.5), majorRegression: z.number().min(1).max(30).default(8) }, guarded(async args => autotune.finalizeVerification(args)));
server.tool('theater_verification_start', 'Create immutable, matched Speaker Preset 1 and Speaker Preset 2 verification datasets using identical channels, positions and sweep mappings.', { positions: z.number().int().min(1).max(7), channels: z.array(z.string()).min(1).max(20), sweepManifestPath: z.string(), topology: z.array(z.string()).min(1).max(20).optional() }, guarded(async args => verification.start(args)));
server.tool('theater_verification_advance', 'Advance one preset verification dataset. Refuses to emit audio if the active Speaker Preset does not match the dataset.', { sessionId: z.string(), ready: z.boolean().default(false) }, guarded(async args => verification.advance(args)));
server.tool('theater_verification_resume_manual', 'Resume a manually-started REW verification measurement after re-checking active Speaker Preset and live receiver safety.', { sessionId: z.string() }, guarded(async ({ sessionId }) => verification.resumeManual({ sessionId })));
server.tool('theater_verification_finalize', 'High-level evidence-only finalization. Validates matched coverage, derives all seven metrics, scores both presets, rejects major regressions, writes a report, and recommends Preset 1 or Preset 2.', { baselineSessionId: z.string(), candidateSessionId: z.string(), reportSessionId: z.string().optional(), minimumGain: z.number().min(0).max(20).default(0.5), majorRegression: z.number().min(1).max(30).default(8) }, guarded(async args => verification.finalize(args)));
server.tool('theater_autotune_finalize_verification', 'Deprecated manual-score finalizer. It is intentionally blocked because final autotune acceptance must come from matched measured verification evidence.', { sessionId: z.string() }, guarded(async ({ sessionId }) => ({
  sessionId,
  finalized: false,
  blocked: true,
  reason: 'Manual numeric scores cannot finalize an autotune session. Use theater_autotune_begin_verification, complete Preset 1 and Preset 2 measurements, then use theater_autotune_finalize_measured.'
})));
server.tool('theater_autotune_finalize_from_sessions', 'Compatibility finalizer for explicitly supplied measured sessions. Parent-owned workflows should use theater_autotune_finalize_measured.', { sessionId: z.string(), baselineSessionId: z.string(), candidateSessionId: z.string(), changes: z.array(z.record(z.any())).default([]), remainingIssues: z.array(z.union([z.string(), z.record(z.any())])).default([]), minimumGain: z.number().min(0).max(20).default(0.5), majorRegression: z.number().min(1).max(30).default(8) }, guarded(async ({ sessionId, baselineSessionId, candidateSessionId, changes, remainingIssues, minimumGain, majorRegression }) => {
  const [baselineRecords, candidateRecords] = await Promise.all([sessions.readMeasurementRecords(baselineSessionId, { acceptedOnly: true }), sessions.readMeasurementRecords(candidateSessionId, { acceptedOnly: true })]);
  const coverage = validateMatchedCoverage(baselineRecords, candidateRecords);
  if (!coverage.valid) return { finalized: false, blocked: true, coverage };
  const measured = finalizeMeasuredComparison(baselineRecords, candidateRecords, { minimumGain, majorRegression });
  if (measured.baseline.missing.length || measured.candidate.missing.length) return { finalized: false, blocked: true, measured };
  const evidencePath = await sessions.writeJson(sessionId, 'optimized/derived-evidence.json', { schemaVersion: 2, derivedAt: new Date().toISOString(), measured });
  const finalized = await theater.finalizeVerification({ sessionId, baselineMetrics: Object.fromEntries(Object.entries(measured.baseline.components).map(([name, item]) => [name, item.score])), candidateMetrics: Object.fromEntries(Object.entries(measured.candidate.components).map(([name, item]) => [name, item.score])), changes, remainingIssues, minimumGain, majorRegression });
  return { finalized: true, evidencePath, measured, result: finalized };
}));
server.tool('measurement_preflight', 'Check REW/Measure From File, live Denon input-volume-mute safety, Shield ADB connectivity, and automatic-measurement capability.', {}, guarded(async () => measurement.preflight()));
server.tool('measurement_measure_channel', 'Prepare REW Measure From File, verify live receiver safety, trigger the measurement when licensed, start the matching Shield sweep, verify Atmos, capture REW evidence, and persist an immutable attempt.', { sessionId: z.string(), position: z.number().int().min(0).max(6), channel: z.string(), shieldFile: z.string(), stimulusPath: z.string(), title: z.string().optional(), notes: z.string().optional(), verifyAtmos: z.boolean().default(true), expectedPreset: z.number().int().min(1).max(2).optional(), measurementType: z.string().optional() }, guarded(async args => measurement.measureChannel(args)));
server.tool('measurement_capture_new', 'Complete or adopt exactly one manual REW measurement and persist its immutable evidence. Proof/verification manual resumes must use their dedicated workflow tools so negotiated settings cannot be fabricated by a caller.', { sessionId: z.string(), position: z.number().int().min(0).max(6), channel: z.string(), beforeMeasurementKeys: z.array(z.string()), shieldFile: z.string().optional(), expectedPreset: z.number().int().min(1).max(2).optional(), measurementType: z.string().optional() }, guarded(async args => measurement.captureManual(args)));
server.tool('shield_status', 'Verify ADB connectivity to the NVIDIA Shield and report basic device information.', {}, guarded(async () => shield.status()));
server.tool('shield_list_sweeps', 'List allowlisted sweep filenames in a channel folder on the Shield.', { channel: z.string() }, guarded(async ({ channel }) => ({ channel, files: await shield.listSweeps(channel) })));
server.tool('shield_play_sweep', 'Start one configured encoded sweep on the Shield. This does not change AVR settings.', { channel: z.string(), fileName: z.string() }, guarded(async ({ channel, fileName }) => shield.playSweep(channel, fileName)));
server.tool('shield_stop', 'Stop/pause current Shield media playback.', {}, guarded(async () => shield.stop()));
server.tool('shield_verify_atmos', 'Read receiver status through EvoBurrow and poll briefly for evidence that the active decoder/status identifies Atmos.', {}, guarded(async () => denon.verifyAtmos()));
server.tool('rew_status', 'Read REW version, audio state, measurement modes, and negotiated command capability without changing anything.', {}, guarded(async () => rew.status()));
server.tool('rew_measurement_contract', 'Read REW-advertised command/playback/mode choices and verify the exact Measure From File contract this project will use.', {}, guarded(async () => rew.measurementContract()));
server.tool('rew_input_level_check', 'Run EvoBurrow bounded microphone input-level capture. Requires confirm=true because it starts capture, but emits no sweep.', { durationMs: z.number().int().min(1000).max(15000).default(4000), confirm: z.boolean().default(false) }, guarded(async args => rew.inputLevelCheck(args)));
server.tool('calibration_score', 'Calculate the transparent weighted calibration score from measured component metrics. Missing metrics lower confidence.', { metrics: z.object({ bassIntegration: z.number().min(0).max(100).optional(), crossoverIntegration: z.number().min(0).max(100).optional(), timing: z.number().min(0).max(100).optional(), frequencyResponse: z.number().min(0).max(100).optional(), channelConsistency: z.number().min(0).max(100).optional(), seatConsistency: z.number().min(0).max(100).optional(), headroom: z.number().min(0).max(100).optional() }) }, guarded(async ({ metrics }) => scoreCalibration(metrics)));
server.tool('calibration_derive_session_metrics', 'Derive objective scoring components from accepted REW session evidence, including raw dB/ms/THD statistics.', { sessionId: z.string() }, guarded(async ({ sessionId }) => deriveSessionEvidence(sessionId)));
server.tool('calibration_compare_sessions', 'Compare two measured sessions only when matched-coverage validation passes. Mismatched evidence is returned as blocked, not scored.', { baselineSessionId: z.string(), candidateSessionId: z.string(), minimumGain: z.number().min(0).max(20).default(0.5), majorRegression: z.number().min(1).max(30).default(8) }, guarded(async ({ baselineSessionId, candidateSessionId, minimumGain, majorRegression }) => {
  const [baselineRecords, candidateRecords] = await Promise.all([sessions.readMeasurementRecords(baselineSessionId, { acceptedOnly: true }), sessions.readMeasurementRecords(candidateSessionId, { acceptedOnly: true })]);
  const coverage = validateMatchedCoverage(baselineRecords, candidateRecords);
  if (!coverage.valid) return { compared: false, blocked: true, coverage };
  const baseline = await deriveSessionEvidence(baselineSessionId);
  const candidate = await deriveSessionEvidence(candidateSessionId);
  return { compared: true, coverage, baseline, candidate, comparison: compareScores(baseline.score, candidate.score, { minimumGain, majorRegression }), missing: { baseline: missingDerivedMetrics(baseline.derived), candidate: missingDerivedMetrics(candidate.derived) } };
}));
server.tool('calibration_compare_scores', 'Apply the acceptance rule to supplied component scores for analysis only. This cannot finalize or recommend a preset without measured session verification.', { baselineMetrics: z.record(z.number()), candidateMetrics: z.record(z.number()), minimumGain: z.number().min(0).max(20).default(0.5), majorRegression: z.number().min(1).max(30).default(8) }, guarded(async ({ baselineMetrics, candidateMetrics, minimumGain, majorRegression }) => {
  const baseline = scoreCalibration(baselineMetrics);
  const candidate = scoreCalibration(candidateMetrics);
  return { baseline, candidate, comparison: compareScores(baseline, candidate, { minimumGain, majorRegression }), advisoryOnly: true };
}));
server.tool('calibration_crossover_candidates', 'Generate bounded crossover candidates from measured speaker extension. Proposals require real summed-response verification.', { f3Hz: z.number().positive().optional(), currentHz: z.number().positive().optional(), role: z.string().default('speaker') }, guarded(async args => ({ candidatesHz: crossoverCandidates(args), rule: 'Test and re-measure each candidate, do not accept from prediction alone.' })));
server.tool('calibration_delay_candidate', 'Translate measured arrival-time offset into a candidate AVR distance/delay adjustment. Proposal only.', { measuredOffsetMs: z.number(), currentDistanceMeters: z.number().min(0).max(18) }, guarded(async args => proposeDelayAdjustment(args)));

// V2 uses the same adapters and application services as the dashboard. No optimization logic lives in handlers.
registerV2Tools(server, {
  config,
  sessions,
  theater,
  denon,
  calibration: v2Calibration,
  nativeProbe,
  audysseyRewImport,
  guarded
});

const transport = new StdioServerTransport();
await server.connect(transport);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await evoburrow.close().catch(() => {}); process.exit(0); });
