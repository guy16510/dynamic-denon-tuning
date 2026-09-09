function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : 'n/a';
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
    `Measured score delta: ${Number.isFinite(comparison?.overallDelta) ? `${comparison.overallDelta >= 0 ? '+' : ''}${fmt(comparison.overallDelta)}` : 'n/a'}`,
    '',
    '> No acoustic change is considered an improvement until it has been re-measured.',
    ''
  ];

  if (comparison?.regressions?.length) {
    lines.push('### Major regressions', '');
    for (const item of comparison.regressions) {
      lines.push(`- ${item.name}: ${fmt(item.before)} -> ${fmt(item.after)} (${fmt(item.delta)})`);
    }
    lines.push('');
  }

  if (comparison?.improvements?.length) {
    lines.push('### Measured improvements', '');
    for (const item of comparison.improvements) {
      lines.push(`- ${item.name}: ${fmt(item.before)} -> ${fmt(item.after)} (+${fmt(item.delta)})`);
    }
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
