const MIRROR_PAIRS = Object.freeze([
  ['FL', 'FR'],
  ['SL', 'SR'],
  ['SBL', 'SBR'],
  ['TFL', 'TFR'],
  ['TRL', 'TRR']
]);

function finite(values) {
  return values.filter(Number.isFinite);
}

function median(values) {
  const sorted = finite(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = finite(values).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * fraction));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const mix = index - lower;
  return sorted[lower] * (1 - mix) + sorted[upper] * mix;
}

function rms(values) {
  const usable = finite(values);
  return usable.length ? Math.sqrt(usable.reduce((sum, value) => sum + value * value, 0) / usable.length) : null;
}

function scoreLowerIsBetter(value, good, bad) {
  if (!Number.isFinite(value)) return null;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round((100 * (bad - value) / (bad - good)) * 10) / 10;
}

function isSubwoofer(channel) {
  return /^(?:SW|SUB)/i.test(channel || '');
}

function traceData(trace) {
  return trace?.data?.data && !Array.isArray(trace.data.data)
    ? trace.data.data
    : (trace?.data || trace || {});
}

function frequencyResponseData(record) {
  const data = traceData(record?.traces?.frequencyResponse);
  return {
    frequency: finite(Array.isArray(data.frequency) ? data.frequency.map(Number) : []),
    magnitude: finite(Array.isArray(data.magnitude) ? data.magnitude.map(Number) : [])
  };
}

function interpolate(xs, ys, x) {
  if (xs.length < 2 || ys.length < 2 || x < xs[0] || x > xs.at(-1)) return null;
  let high = 1;
  while (high < xs.length && xs[high] < x) high += 1;
  const low = high - 1;
  const width = xs[high] - xs[low];
  if (!Number.isFinite(width) || width === 0) return ys[low];
  const fraction = (x - xs[low]) / width;
  return ys[low] + fraction * (ys[high] - ys[low]);
}

function logGrid(lowHz, highHz, ppo = 12) {
  const points = [];
  for (let frequency = lowHz; frequency <= highHz * 1.00001; frequency *= 2 ** (1 / ppo)) {
    points.push(frequency);
  }
  return points;
}

function band(record, lowHz, highHz, ppo = 12) {
  const { frequency, magnitude } = frequencyResponseData(record);
  if (frequency.length !== magnitude.length || frequency.length < 2) return null;
  const frequencies = logGrid(lowHz, highHz, ppo);
  const values = frequencies.map(value => interpolate(frequency, magnitude, value));
  if (values.filter(Number.isFinite).length < frequencies.length * 0.8) return null;
  return { frequency: frequencies, magnitude: values };
}

function detrend(series) {
  if (!series) return null;
  const points = series.frequency
    .map((frequency, index) => [Math.log2(frequency), series.magnitude[index]])
    .filter(([, value]) => Number.isFinite(value));
  if (points.length < 4) return null;

  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  return points.map(([x, y]) => y - (intercept + slope * x));
}

function normalized(series) {
  if (!series) return null;
  const level = median(series.magnitude);
  if (level == null) return null;
  return {
    ...series,
    magnitude: series.magnitude.map(value => Number.isFinite(value) ? value - level : null)
  };
}

function rmsDifference(left, right) {
  if (!left || !right || left.frequency.length !== right.frequency.length) return null;
  return rms(left.magnitude.map((value, index) => (
    Number.isFinite(value) && Number.isFinite(right.magnitude[index])
      ? value - right.magnitude[index]
      : null
  )));
}

function peakTimeSeconds(record) {
  const fromSummary = Number(record?.summary?.timeOfIRPeakSeconds);
  if (Number.isFinite(fromSummary)) return fromSummary;
  const impulse = traceData(record?.traces?.impulseResponse);
  const fromTrace = Number(impulse.peakTimeSeconds);
  return Number.isFinite(fromTrace) ? fromTrace : null;
}

function distortionThd(record) {
  const trace = record?.traces?.distortion;
  if (!trace || trace.unavailable) return null;
  const data = traceData(trace);
  const headers = data.columnHeaders || data.headers || data.columns;
  const rows = data.data || data.values;
  if (!Array.isArray(headers) || !Array.isArray(rows) || !rows.length) return null;

  const frequencyIndex = headers.findIndex(header => /freq/i.test(String(header)));
  const thdIndex = headers.findIndex(header => (
    /^\s*THD(?:\s*\(%?\))?\s*$/i.test(String(header))
    || /total harmonic distortion/i.test(String(header))
  ));
  if (frequencyIndex < 0 || thdIndex < 0) return null;

  const values = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const frequency = Number(row[frequencyIndex]);
    const value = Number(row[thdIndex]);
    if (Number.isFinite(frequency) && Number.isFinite(value) && frequency >= 100 && frequency <= 5000) {
      values.push(value);
    }
  }
  return values;
}

export function deriveCalibrationMetrics(records, { minimumAcceptedRecords = 3 } = {}) {
  const accepted = (records || []).filter(record => (
    record
    && record.acceptedForOptimization !== false
    && record.traces?.frequencyResponse
  ));
  const speakers = accepted.filter(record => !isSubwoofer(record.channel));
  const evidence = {};
  const metrics = {};
  const caveats = [];

  if (accepted.length < minimumAcceptedRecords) {
    caveats.push(`Only ${accepted.length} accepted measurement records were available; broad calibration scoring may be unstable.`);
  }

  const responseRms = speakers
    .map(record => rms(detrend(band(record, 200, 10000, 12))))
    .filter(Number.isFinite);
  if (responseRms.length) {
    const value = median(responseRms);
    metrics.frequencyResponse = scoreLowerIsBetter(value, 1.5, 7);
    evidence.frequencyResponse = {
      statistic: 'median detrended response RMS',
      valueDb: +value.toFixed(3),
      recordsUsed: responseRms.length,
      goodAtOrBelowDb: 1.5,
      badAtOrAboveDb: 7,
      caveat: 'Detrending preserves broad house-curve slope; the score targets response roughness rather than flatness.'
    };
  }

  const bassSpread = speakers
    .map(record => {
      const residual = detrend(band(record, 25, 200, 12));
      if (!residual) return null;
      const p90 = percentile(residual, 0.9);
      const p10 = percentile(residual, 0.1);
      return Number.isFinite(p90) && Number.isFinite(p10) ? p90 - p10 : null;
    })
    .filter(Number.isFinite);
  if (bassSpread.length) {
    const value = median(bassSpread);
    metrics.bassIntegration = scoreLowerIsBetter(value, 5, 18);
    evidence.bassIntegration = {
      statistic: 'median 25-200 Hz detrended P90-P10 spread',
      valueDb: +value.toFixed(3),
      recordsUsed: bassSpread.length,
      goodAtOrBelowDb: 5,
      badAtOrAboveDb: 18,
      caveat: 'This measures bass-managed acoustic continuity and modal variation, not standalone subwoofer maximum output.'
    };
  }

  const crossoverDips = speakers
    .map(record => {
      const residual = detrend(band(record, 50, 180, 24));
      if (!residual) return null;
      const p10 = percentile(residual, 0.1);
      return Number.isFinite(p10) ? Math.max(0, -p10) : null;
    })
    .filter(Number.isFinite);
  if (crossoverDips.length) {
    const value = percentile(crossoverDips, 0.8);
    metrics.crossoverIntegration = scoreLowerIsBetter(value, 2.5, 10);
    evidence.crossoverIntegration = {
      statistic: '80th-percentile crossover-band lower-tail dip',
      valueDb: +value.toFixed(3),
      recordsUsed: crossoverDips.length,
      bandHz: [50, 180],
      goodAtOrBelowDb: 2.5,
      badAtOrAboveDb: 10,
      caveat: 'The band covers common theater crossover choices; exact candidate testing still requires measured before/after summation.'
    };
  }

  const byPosition = new Map();
  for (const record of speakers) {
    const time = peakTimeSeconds(record);
    if (!Number.isFinite(time)) continue;
    const values = byPosition.get(record.position) || [];
    values.push(time * 1000);
    byPosition.set(record.position, values);
  }
  const timingSpreads = [];
  for (const values of byPosition.values()) {
    if (values.length < 3) continue;
    timingSpreads.push(percentile(values, 0.9) - percentile(values, 0.1));
  }
  if (timingSpreads.length) {
    const value = percentile(timingSpreads, 0.8);
    metrics.timing = scoreLowerIsBetter(value, 0.3, 2.5);
    evidence.timing = {
      statistic: '80th-percentile per-position P90-P10 arrival spread',
      valueMs: +value.toFixed(4),
      positionsUsed: timingSpreads.length,
      goodAtOrBelowMs: 0.3,
      badAtOrAboveMs: 2.5
    };
  }

  const recordMap = new Map(accepted.map(record => [
    `${record.position}:${String(record.channel).toUpperCase()}`,
    record
  ]));
  const positions = new Set(accepted.map(record => record.position));
  const pairDifferences = [];
  for (const [left, right] of MIRROR_PAIRS) {
    for (const position of positions) {
      const leftRecord = recordMap.get(`${position}:${left}`);
      const rightRecord = recordMap.get(`${position}:${right}`);
      if (!leftRecord || !rightRecord) continue;
      const difference = rmsDifference(
        normalized(band(leftRecord, 250, 10000, 12)),
        normalized(band(rightRecord, 250, 10000, 12))
      );
      if (Number.isFinite(difference)) pairDifferences.push(difference);
    }
  }
  if (pairDifferences.length) {
    const value = median(pairDifferences);
    metrics.channelConsistency = scoreLowerIsBetter(value, 1.5, 6);
    evidence.channelConsistency = {
      statistic: 'median normalized mirror-pair RMS mismatch',
      valueDb: +value.toFixed(3),
      comparisons: pairDifferences.length,
      goodAtOrBelowDb: 1.5,
      badAtOrAboveDb: 6
    };
  }

  const byChannel = new Map();
  for (const record of speakers) {
    const key = String(record.channel).toUpperCase();
    const rows = byChannel.get(key) || [];
    rows.push(record);
    byChannel.set(key, rows);
  }
  const seatDifferences = [];
  for (const rows of byChannel.values()) {
    if (rows.length < 2) continue;
    for (let left = 0; left < rows.length; left += 1) {
      for (let right = left + 1; right < rows.length; right += 1) {
        const difference = rmsDifference(
          normalized(band(rows[left], 30, 500, 12)),
          normalized(band(rows[right], 30, 500, 12))
        );
        if (Number.isFinite(difference)) seatDifferences.push(difference);
      }
    }
  }
  if (seatDifferences.length) {
    const value = median(seatDifferences);
    metrics.seatConsistency = scoreLowerIsBetter(value, 2, 8);
    evidence.seatConsistency = {
      statistic: 'median 30-500 Hz normalized inter-seat RMS mismatch',
      valueDb: +value.toFixed(3),
      comparisons: seatDifferences.length,
      goodAtOrBelowDb: 2,
      badAtOrAboveDb: 8
    };
  }

  const recordThd = [];
  for (const record of speakers) {
    const values = distortionThd(record);
    if (values?.length) recordThd.push(percentile(values, 0.9));
  }
  if (recordThd.length) {
    const value = percentile(recordThd, 0.8);
    metrics.headroom = scoreLowerIsBetter(value, 1, 10);
    evidence.headroom = {
      statistic: '80th-percentile across records of 100-5000 Hz P90 THD',
      valuePercent: +value.toFixed(3),
      recordsUsed: recordThd.length,
      goodAtOrBelowPercent: 1,
      badAtOrAbovePercent: 10,
      caveat: 'This is a single-level distortion margin proxy, not a maximum-SPL or compression test.'
    };
  } else {
    caveats.push('No usable THD column was available, so headroom was not scored. A maximum-output claim is not inferred from frequency response alone.');
  }

  return {
    schemaVersion: 1,
    recordCount: (records || []).length,
    acceptedRecordCount: accepted.length,
    metrics,
    evidence,
    caveats
  };
}
