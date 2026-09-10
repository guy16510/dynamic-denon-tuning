import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { matchedVerificationCapabilities } from '../calibration/objective-v2.js';

export function registerV2Tools(server, { config, sessions, theater, denon, calibration, nativeProbe, audysseyRewImport, guarded }) {
  const sessionId = z.string().min(1);

  server.tool('theater_v2_status', 'V2 application status. Reports deterministic calibration mode, safety defaults, hardware state, and current sessions without changing receiver state.', {}, guarded(async () => ({
    productMode: 'guided-automatic-calibration', receiver: 'Denon AVR-X3700H', protectedPreset: 1, candidatePreset: 2,
    receiverWritesEnabled: config.denon.allowWrites, nativeMeasurement: await nativeProbe.probe(),
    dashboard: { host: config.dashboard.host, port: config.dashboard.port }, sessions: await calibration.listSessions()
  })));
  server.tool('calibration_profiles', 'List deterministic target profiles and their locked hashes.', {}, guarded(async () => calibration.profiles()));
  server.tool('calibration_create', 'Create a V2 deterministic calibration session. Optionally import an existing Audyssey .ady as immutable source evidence.', { profilePath: z.string().optional(), sourceAdy: z.string().optional() }, guarded(async args => calibration.create(args)));
  server.tool('calibration_start', 'Start or retry V2 preflight. This does not bypass hardware gates and remains guided until required automation and post-correction proof exist.', { sessionId }, guarded(async args => calibration.start(args)));
  server.tool('calibration_status', 'Read persisted V2 state, source evidence, capability status and champion state.', { sessionId }, guarded(async ({ sessionId }) => calibration.status(sessionId)));
  server.tool('calibration_pause', 'Pause a V2 calibration, stop active Shield stimulus when possible, preserve evidence, and keep champion state intact.', { sessionId }, guarded(async args => calibration.pause(args)));
  server.tool('calibration_resume', 'Resume a paused or blocked V2 calibration from its persisted checkpoint.', { sessionId }, guarded(async args => calibration.resume(args)));
  server.tool('calibration_abort', 'Abort a V2 calibration, stop active stimulus when possible, preserve evidence, and release its hardware lock.', { sessionId }, guarded(async args => calibration.abort(args)));
  server.tool('calibration_best', 'Return the highest-scoring valid measured champion currently persisted for a V2 session. No LLM ranking is performed.', { sessionId }, guarded(async ({ sessionId }) => {
    const status = await calibration.status(sessionId);
    return { sessionId, champion: status.champion, definition: 'highest-scoring measured candidate found within the declared parameter search space under the locked objective with no safety or major-regression violations' };
  }));
  server.tool('calibration_explain_candidate', 'Explain one candidate from stored deterministic diffs and immutable events. Explanations are fact retrieval, not calibration decisions.', { sessionId, candidateId: z.string().min(1) }, guarded(async ({ sessionId, candidateId }) => {
    const [candidates, events] = await Promise.all([calibration.candidatesFor(sessionId), calibration.eventsFor(sessionId)]);
    const candidate = candidates.find(item => item.candidateId === candidateId) || null;
    return { sessionId, candidateId, found: Boolean(candidate), candidate, events: events.filter(event => event.data?.candidateId === candidateId) };
  }));
  server.tool('calibration_compare', 'Compare two persisted V2 champions while explicitly reporting whether their source capabilities permit physical post-correction verification.', { baselineSessionId: sessionId, candidateSessionId: sessionId }, guarded(async ({ baselineSessionId, candidateSessionId }) => {
    const [baseline, candidate] = await Promise.all([calibration.status(baselineSessionId), calibration.status(candidateSessionId)]);
    const baselineCapabilities = baseline.champion?.score?.capabilities || baseline.measurementCapability || {};
    const candidateCapabilities = candidate.champion?.score?.capabilities || candidate.measurementCapability || {};
    const capabilities = matchedVerificationCapabilities(baselineCapabilities, candidateCapabilities);
    return { baseline: { sessionId: baselineSessionId, champion: baseline.champion }, candidate: { sessionId: candidateSessionId, champion: candidate.champion }, capabilities, physicallyVerifiable: capabilities.physicallyVerifiable, rule: 'Search scores may be inspected, but final physical acceptance requires matched methodology and post-correction measurement evidence.' };
  }));
  server.tool('calibration_apply_best', 'Apply/select the persisted physically verified champion on Speaker Preset 2. Fails closed if verification or receiver-write capability is missing.', { sessionId }, guarded(async args => calibration.applyBest(args)));
  server.tool('calibration_restore_baseline', 'Restore/select protected Speaker Preset 1. Receiver writes remain disabled by default and the Denon adapter must expose a verified allowlisted preset capability.', { sessionId }, guarded(async ({ sessionId }) => {
    if (!config.denon.allowWrites) return { restored: false, blocked: true, sessionId, reason: 'ALLOW_RECEIVER_WRITES is disabled.' };
    await denon.selectPreset(1);
    return { restored: true, sessionId, preset: 1 };
  }));
  server.tool('audyssey_import', 'Import an Audyssey .ady into a V2 session as immutable source evidence and export deterministic REW-compatible impulses.', { sessionId, path: z.string().min(1) }, guarded(async args => calibration.importAudyssey(args)));
  server.tool('audyssey_rew_import', 'Import the session original .ady ResponseData into REW using REW documented impulse-response-data API. Does not measure the room or prove post-correction response.', { sessionId }, guarded(async ({ sessionId }) => {
    const path = sessions.path(sessionId, 'audyssey/source/original.ady');
    const text = await readFile(path, 'utf8');
    return audysseyRewImport.importText(text, { sourceFilename: path, sessionId });
  }));
  server.tool('audyssey_measurement_status', 'Report Denon-native microphone capability from persisted controlled hardware evidence. Unknown remains unknown.', { sessionId: sessionId.optional() }, guarded(async args => nativeProbe.probe(args)));
  server.tool('audyssey_measurement_probe', 'Run the evidence-only native measurement capability probe. It never sends guessed or undocumented Audyssey commands.', { sessionId: sessionId.optional() }, guarded(async args => nativeProbe.probe(args)));
  server.tool('dashboard_status', 'Report the configured local V2 dashboard endpoint and launch command. The MCP process does not silently open a network listener.', {}, guarded(async () => ({ configured: true, runningInMcpProcess: false, url: `http://${config.dashboard.host}:${config.dashboard.port}`, command: 'npm run dashboard', productMode: 'guided-automatic-calibration' })));
}
