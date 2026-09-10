const CHANNEL_MAP = Object.freeze({
  FL: 'FL', FR: 'FR', C: 'C', SL: 'SL', SR: 'SR', SBL: 'SBL', SBR: 'SBR',
  FHL: 'TFL', FHR: 'TFR', TFL: 'TFL', TFR: 'TFR', TRL: 'TRL', TRR: 'TRR',
  RHL: 'TRL', RHR: 'TRR', SW: 'SW1', SW1: 'SW1', SW2: 'SW2'
});

export function normalizeAudysseyChannel(channel) {
  const source = String(channel || '').trim().toUpperCase();
  return CHANNEL_MAP[source] || source.replace(/[^A-Z0-9]/g, '_');
}

export function rewImpulseFilename(channel, position) {
  return `${normalizeAudysseyChannel(channel)}-P${Number(position)}.txt`;
}

export function exportRewImpulse({ samples, sampleRateHz, channel, position = 0 }) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('impulse samples are required');
  const rate = Number(sampleRateHz);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('sampleRateHz must be positive');
  let peakIndex = 0;
  let peakValue = samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > Math.abs(peakValue)) { peakValue = samples[i]; peakIndex = i; }
  }
  const interval = 1 / rate;
  const lines = [
    '* Impulse Response data saved by Dynamic Denon Tuning',
    `${peakValue} // Peak value before normalisation`,
    `${peakIndex} // Peak index`,
    `${samples.length} // Response length`,
    `${interval} // Sample interval (seconds)`,
    '0.0 // Start time (seconds)',
    '* Data start',
    ...samples.map(value => String(Number(value)))
  ];
  return { filename: rewImpulseFilename(channel, position), text: `${lines.join('\n')}\n`, sampleIntervalSeconds: interval, peakIndex, peakValue };
}
