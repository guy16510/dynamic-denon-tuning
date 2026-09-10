const KNOWN = new Set(['FL','FR','C','SL','SR','SBL','SBR','TFL','TFR','TML','TMR','TRL','TRR','FHL','FHR','RHL','RHR','SW1','SW2','SW3','SW4']);

function walk(value, path = [], out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, index], out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walk(child, [...path, key], out);
    return out;
  }
  out.push({ path: path.join('.'), value });
  return out;
}

export function normalizeChannelToken(value) {
  const raw = String(value).trim().toUpperCase().replace(/[\s_-]+/g, '');
  const aliases = {
    FRONTLEFT: 'FL', FRONTRIGHT: 'FR', CENTER: 'C',
    SURROUNDLEFT: 'SL', SURROUNDRIGHT: 'SR',
    SURROUNDBACKLEFT: 'SBL', SURROUNDBACKRIGHT: 'SBR',
    TOPFRONTLEFT: 'TFL', TOPFRONTRIGHT: 'TFR',
    TOPMIDDLELEFT: 'TML', TOPMIDDLERIGHT: 'TMR',
    TOPREARLEFT: 'TRL', TOPREARRIGHT: 'TRR',
    FRONTHEIGHTLEFT: 'FHL', FRONTHEIGHTRIGHT: 'FHR',
    REARHEIGHTLEFT: 'RHL', REARHEIGHTRIGHT: 'RHR',
    SUBWOOFER1: 'SW1', SUB1: 'SW1', SUBWOOFER2: 'SW2', SUB2: 'SW2',
    SUBWOOFER3: 'SW3', SUB3: 'SW3', SUBWOOFER4: 'SW4', SUB4: 'SW4'
  };
  return aliases[raw] || raw;
}

export function isKnownChannel(value) {
  return KNOWN.has(normalizeChannelToken(value));
}

export function detectTopology(denonInspection, explicitChannels = null) {
  if (Array.isArray(explicitChannels) && explicitChannels.length) {
    const suppliedChannels = [...new Set(explicitChannels.map(normalizeChannelToken))];
    const unknown = suppliedChannels.filter(channel => !KNOWN.has(channel));
    if (unknown.length) {
      return {
        source: 'user-provided',
        confidence: 'insufficient',
        channels: [],
        suppliedChannels,
        unknown,
        protectedSettingsReadOnly: true,
        blockers: [`Unknown channel tokens cannot be used for V1 measurement: ${unknown.join(', ')}`]
      };
    }
    return {
      source: 'user-provided',
      confidence: 'high',
      channels: suppliedChannels,
      unknown: [],
      protectedSettingsReadOnly: true,
      blockers: []
    };
  }

  const leaves = walk(denonInspection);
  const active = new Set();
  const evidence = [];
  for (const leaf of leaves) {
    const path = leaf.path.toLowerCase();
    if (!/(speaker|channel|terminal|layout|config|topology)/.test(path)) continue;
    if (leaf.value === false || leaf.value === 0 || /^none|off|disabled$/i.test(String(leaf.value))) continue;
    const candidates = [leaf.path.split('.').at(-1), leaf.value];
    for (const candidate of candidates) {
      const token = normalizeChannelToken(candidate);
      if (KNOWN.has(token)) {
        active.add(token);
        evidence.push({ channel: token, path: leaf.path, value: leaf.value });
      }
    }
  }
  const detectedChannels = [...active].sort();
  const confidence = detectedChannels.length >= 2 ? 'medium' : 'low';
  return {
    source: detectedChannels.length ? 'denon-read-only-inspection' : 'undetected',
    confidence,
    channels: [],
    detectedChannels,
    evidence,
    protectedSettingsReadOnly: true,
    blockers: [
      detectedChannels.length
        ? 'Candidate active channels were observed in read-only Denon/EvoBurrow data, but this payload mapping is not hardware-validated yet. Supply explicit channels for V1.'
        : 'Active speaker topology could not be confidently detected. Supply explicit channels; topology writes remain prohibited.'
    ]
  };
}
