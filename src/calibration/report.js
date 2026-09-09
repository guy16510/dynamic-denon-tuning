function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : 'n/a';
}

function signed(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${fmt(value)}` : 'n/a';
}

function componentMap(score) {
  return new Map((score?.components || []).map(component => [component.name, component.score]));
}

function attemptLine(row) {
  const parts = [
    `position ${row.position}`,
    String(row.channel || 'unknown channel'),
    `attempt ${row.attempt ?? 'n/a'}`,
    `REW ${row.rewId || 'n/a'}`
  ];
  if (row.path) parts.push(row.path);
  return parts.join(', ');
}

function relevantText(component) {
  const channels = component?.relevant?.channels || [];
  const positions = component?.relevant?.positions || [];
  return `channels [${channels.join(', ') || 'none'}], positions [${positions.join(', ') || 'none'}]`;
}

export function renderCalibrationReport({
  receiver = 'Denon AVR-X3700H',
  topology = null,
  baseline,
  candidate,
  comparison,
  changes = [],
  remainingIssues = []
}) {
  const lines = [
    `# ${receiver} Atmos Calibration Report`,
    '',
    `Generated: ${new Date().toISOString()}`,
    ...(topology ? ['', `Speaker configuration: ${topology}`] : []),
    '',
    '## Baseline',
    '',
    `Calibration score: ${fmt(baseline?.score)}`,
    `Confidence: ${baseline?.confidence || 'unknown'}`,
    '',
    '## Optimized candidate',
    '',
    `Calibration score: ${fmt(candidate?.score)}`,
    `Confidence: ${candidate?.confidence || 'unknown'}`,
    '',
    '## Verification result',
    '',
    `Accepted: ${comparison?.accepted ? 'yes' : 'no'}`,
    `Measured score delta: ${signed(comparison?.overallDelta)}`,
    '',
    '> No acoustic change is considered an improvement until it has been re-measured.',
    ''
  ];

  if (comparison?.regressions?.length) {
    lines.push('### Major regressions', '');
    for (const item of comparison.regressions) lines.push(`- ${item.name}: ${fmt(item.before)} -> ${fmt(item.after)} (${signed(item.delta)})`);
    lines.push('');
  }
  if (comparison?.improvements?.length) {
    lines.push('### Measured improvements', '');
    for (const item of comparison.improvements) lines.push(`- ${item.name}: ${fmt(item.before)} -> ${fmt(item.after)} (${signed(item.delta)})`);
    lines.push('');
  }
  if (changes.length) {
    lines.push('## Changes', '');
    for (const change of changes) {
      const label = change.label || change.parameter || change.channel || 'Change';
      lines.push(`- ${label}: ${change.before ?? 'n/a'} -> ${change.after ?? 'n/a'}`);
    }
    lines.push('');
  }
  if (remainingIssues.length) {
    lines.push('## Remaining issues', '');
    for (const issue of remainingIssues) lines.push(`- ${typeof issue === 'string' ? issue : issue.description || JSON.stringify(issue)}`);
    lines.push('');
  }
  lines.push(
    '## Acceptance rule',
    '',
    comparison?.accepted
      ? 'The optimized candidate improved the measured aggregate score without a major component regression.'
      : 'The optimized candidate is not accepted. Keep or return to the baseline preset until another candidate is measured and passes the gate.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

export function renderVerificationReport({ receiver, baselineSessionId, candidateSessionId, baselineState, candidateState, result }) {
  const names = ['bassIntegration', 'crossoverIntegration', 'timing', 'frequencyResponse', 'channelConsistency', 'seatConsistency', 'headroom'];
  const labels = {
    bassIntegration: 'Bass integration',
    crossoverIntegration: 'Crossover integration',
    timing: 'Timing',
    frequencyResponse: 'Frequency response',
    channelConsistency: 'Channel consistency',
    seatConsistency: 'Seat consistency',
    headroom: 'Headroom'
  };
  const b = componentMap(result.baseline?.score);
  const c = componentMap(result.candidate?.score);
  const positions = [...new Set((baselineState?.completed || []).map(row => row.position))].sort((a, b2) => a - b2);
  const channels = baselineState?.channels || [];
  const lines = [
    `# ${receiver} Preset Verification Report`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Baseline session: ${baselineSessionId}`,
    `Candidate session: ${candidateSessionId}`,
    'Preset identities: baseline = Speaker Preset 1, candidate = Speaker Preset 2',
    `Channels measured: ${channels.join(', ') || 'none'}`,
    `Positions measured: ${positions.join(', ') || 'none'}`,
    `Baseline accepted attempts: ${(baselineState?.completed || []).length}`,
    `Baseline rejected attempts: ${(baselineState?.rejectedAttempts || []).length}`,
    `Candidate accepted attempts: ${(candidateState?.completed || []).length}`,
    `Candidate rejected attempts: ${(candidateState?.rejectedAttempts || []).length}`,
    '',
    '## Result',
    '',
    `Status: ${result.status}`,
    `Recommended preset: ${result.recommendedPreset}`,
    `Baseline score: ${fmt(result.baseline?.score?.score)}`,
    `Candidate score: ${fmt(result.candidate?.score?.score)}`,
    `Overall delta: ${signed(result.comparison?.overallDelta)}`,
    `Confidence: ${result.accepted ? 'high' : (result.baseline?.confidence === 'high' && result.candidate?.confidence === 'high' ? 'high, but acceptance gate failed' : 'insufficient')}`,
    '',
    '| Metric | Preset 1 | Preset 2 | Delta |',
    '| --- | ---: | ---: | ---: |'
  ];
  for (const name of names) lines.push(`| ${labels[name]} | ${fmt(b.get(name))} | ${fmt(c.get(name))} | ${signed((c.get(name) ?? NaN) - (b.get(name) ?? NaN))} |`);

  lines.push('', '## Measurement attempt history', '');
  lines.push('### Speaker Preset 1 accepted', '');
  if (baselineState?.completed?.length) for (const row of baselineState.completed) lines.push(`- ${attemptLine(row)}`);
  else lines.push('- None');
  lines.push('', '### Speaker Preset 1 rejected', '');
  if (baselineState?.rejectedAttempts?.length) for (const row of baselineState.rejectedAttempts) lines.push(`- ${attemptLine(row)}`);
  else lines.push('- None');
  lines.push('', '### Speaker Preset 2 accepted', '');
  if (candidateState?.completed?.length) for (const row of candidateState.completed) lines.push(`- ${attemptLine(row)}`);
  else lines.push('- None');
  lines.push('', '### Speaker Preset 2 rejected', '');
  if (candidateState?.rejectedAttempts?.length) for (const row of candidateState.rejectedAttempts) lines.push(`- ${attemptLine(row)}`);
  else lines.push('- None');

  lines.push('', '## Raw measured evidence', '');
  for (const name of names) {
    const before = result.baseline?.components?.[name];
    const after = result.candidate?.components?.[name];
    lines.push(`### ${labels[name]}`, '');
    lines.push(`- Preset 1: ${before ? `${before.rawStatistic} = ${before.rawValue ?? 'n/a'} ${before.units}; score ${fmt(before.score)}; confidence ${before.confidence}` : 'missing'}`);
    if (before) {
      lines.push(`- Preset 1 confidence basis: ${before.confidenceReason || 'not recorded'}`);
      lines.push(`- Preset 1 evidence source: ${before.evidenceSource}`);
      lines.push(`- Preset 1 relevant evidence: ${relevantText(before)}`);
    }
    lines.push(`- Preset 2: ${after ? `${after.rawStatistic} = ${after.rawValue ?? 'n/a'} ${after.units}; score ${fmt(after.score)}; confidence ${after.confidence}` : 'missing'}`);
    if (after) {
      lines.push(`- Preset 2 confidence basis: ${after.confidenceReason || 'not recorded'}`);
      lines.push(`- Preset 2 evidence source: ${after.evidenceSource}`);
      lines.push(`- Preset 2 relevant evidence: ${relevantText(after)}`);
    }
    const assumptions = [...new Set([...(before?.assumptions || []), ...(after?.assumptions || [])])];
    for (const assumption of assumptions) lines.push(`- Assumption/caveat: ${assumption}`);
    lines.push('');
  }

  lines.push('## Coverage validation', '');
  lines.push(`Matched coverage: ${result.coverage?.valid ? 'pass' : 'FAIL'}`);
  if (result.coverage?.issues?.length) for (const issue of result.coverage.issues) lines.push(`- ${JSON.stringify(issue)}`);
  lines.push('');
  if (result.comparison?.improvements?.length) {
    lines.push('## Improvements', '');
    for (const item of result.comparison.improvements) lines.push(`- ${labels[item.name] || item.name}: ${signed(item.delta)}`);
    lines.push('');
  }
  if (result.comparison?.regressions?.length) {
    lines.push('## Major regressions', '');
    for (const item of result.comparison.regressions) lines.push(`- ${labels[item.name] || item.name}: ${signed(item.delta)}`);
    lines.push('');
  }
  lines.push('## Unresolved issues', '');
  if (result.gates?.length) for (const gate of result.gates) lines.push(`- ${gate}`);
  else lines.push('- None in software verification. Real theater hardware validation remains required before merge.');
  lines.push('', '## Remaining manual action', '', result.nextAction, '', '> Every acoustic change must be re-measured before it can be accepted.', '');
  return `${lines.join('\n')}\n`;
}
