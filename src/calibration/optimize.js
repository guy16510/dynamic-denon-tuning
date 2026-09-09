const STANDARD_CROSSOVERS = [40, 60, 70, 80, 90, 100, 110, 120, 150, 180, 200, 250];

export function crossoverCandidates({ f3Hz, currentHz, role = 'speaker' }) {
  const f3 = Number(f3Hz);
  const minimum = Number.isFinite(f3) ? Math.max(40, Math.ceil((f3 * 1.35) / 10) * 10) : null;
  const roleFloor = /atmos|height|top/i.test(role) ? 80 : 40;
  const floor = Math.max(roleFloor, minimum || roleFloor);
  const centered = STANDARD_CROSSOVERS.filter(value => value >= floor);
  const nearestCurrent = Number.isFinite(Number(currentHz))
    ? STANDARD_CROSSOVERS.filter(value => value >= floor && Math.abs(value - Number(currentHz)) <= 40)
    : [];
  return [...new Set([...nearestCurrent, ...centered])].sort((a, b) => a - b).slice(0, 5);
}

export function delayDeltaMetersFromMs(milliseconds, speedOfSoundMps = 343) {
  return Number(milliseconds) * speedOfSoundMps / 1000;
}

export function proposeDelayAdjustment({ measuredOffsetMs, currentDistanceMeters }) {
  const deltaMeters = delayDeltaMetersFromMs(measuredOffsetMs);
  return {
    measuredOffsetMs,
    currentDistanceMeters,
    deltaMeters,
    equivalentDistanceMeters: deltaMeters,
    candidateDistanceMeters: Math.max(0, Number(currentDistanceMeters) + deltaMeters),
    rule: 'AVR distance is treated as a delay control. A real re-measurement is mandatory before acceptance.',
    caveat: 'Positive measuredOffsetMs currently maps to a larger AVR distance value. Verify the receiver model convention experimentally before enabling writes.'
  };
}
