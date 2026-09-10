import { canonicalJson } from '../lib/canonical-json.js';

function classification(champion, capability) {
  if (champion?.verification?.postCorrection === true && capability?.postCorrection === true) return 'physically measured post-correction';
  if (champion?.measuredScore != null || champion?.score?.value != null) return 'physically measured';
  return 'predicted/search only';
}

function line(label, value) {
  return `- ${label}: ${value == null ? 'N/A' : value}`;
}

export function buildV2Report({ session, events = [], receiver = {}, software = {}, measurementCapability = {}, targetProfile = null, audyssey = null, champion = null }) {
  const accepted = events.filter(event => event.type === 'candidate.accepted');
  const rejected = events.filter(event => event.type === 'candidate.rejected');
  const convergence = events.filter(event => event.type === 'optimization.converged').at(-1)?.data || null;
  const score = champion?.score || champion?.evaluation || null;
  const classificationValue = classification(champion, measurementCapability);
  const report = {
    schemaVersion: 2,
    sessionId: session.id,
    hardware: { receiver: session.receiver || 'Denon AVR-X3700H', ...receiver },
    software,
    algorithmVersion: score?.algorithmVersion || champion?.algorithmVersion || null,
    targetProfile: targetProfile ? { name: targetProfile.name, version: targetProfile.version, sha256: targetProfile.sha256 || session.targetProfileHash } : null,
    measurement: {
      source: audyssey ? 'audyssey-ady' : null,
      sourceSha256: audyssey?.sourceSha256 || null,
      capabilities: measurementCapability
    },
    baselineConfiguration: session.baselineConfiguration || null,
    finalConfiguration: champion ? { distances: champion.distances || null, trims: champion.trims || null, crossovers: champion.crossovers || null, audysseySettings: champion.audysseySettings || null } : null,
    baselineScore: session.baselineScore ?? null,
    finalScore: champion?.measuredScore ?? score?.value ?? null,
    components: score?.components || [],
    acceptedCandidates: accepted.map(event => event.data),
    rejectedCandidates: rejected.map(event => event.data),
    convergence,
    unmeasuredDimensions: score?.missingComponents || [],
    confidence: score?.confidence || 'unknown',
    resultClassification: classificationValue,
    physicalPostCorrectionVerified: classificationValue === 'physically measured post-correction'
  };
  const md = [
    '# Dynamic Denon Tuning V2 Report', '',
    line('Session', report.sessionId),
    line('Receiver', report.hardware.receiver),
    line('Algorithm', report.algorithmVersion),
    line('Target profile', report.targetProfile ? `${report.targetProfile.name} v${report.targetProfile.version} (${report.targetProfile.sha256})` : null),
    line('Measurement source', report.measurement.source),
    line('Measurement capability', report.measurement.capabilities.state || report.measurement.capabilities.nativeState || 'unknown'),
    line('Baseline score', report.baselineScore),
    line('Final score', report.finalScore),
    line('Confidence', report.confidence), '',
    `## RESULT CLASSIFICATION: ${report.resultClassification.toUpperCase()}`, '',
    report.physicalPostCorrectionVerified
      ? '**Physical post-correction verification: VERIFIED**'
      : '**Physical post-correction verification: NOT AVAILABLE / NOT VERIFIED WITH CURRENT EVIDENCE**', '',
    '## Component scores', '',
    ...(report.components.length ? report.components.map(component => `- ${component.name}: ${component.score ?? 'N/A'} (${component.confidence || 'unknown'} confidence)`) : ['- N/A']), '',
    '## Candidate history', '',
    `- Accepted: ${accepted.length}`,
    `- Rejected: ${rejected.length}`,
    line('Convergence', convergence ? JSON.stringify(convergence) : null), '',
    '## Unmeasured dimensions', '',
    ...(report.unmeasuredDimensions.length ? report.unmeasuredDimensions.map(item => `- ${item.name || item}: ${item.reason || 'unavailable'}`) : ['- None recorded']), '',
    'This report distinguishes predicted/search results from physical measurement. A score is not acoustic proof without the required matched measurement capability.', ''
  ].join('\n');
  return { json: report, markdown: md, canonicalJson: canonicalJson(report) };
}
