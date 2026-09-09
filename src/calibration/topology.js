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

function normalizeToken(value) {
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
    SUBWOOFER1: 'SW1', SUB1: 'SW1', SUBWOOFER2: 'SW2', SUB2: 'SW2'
  };
  return aliases[raw] || raw;
}

export function detectTopology(denonInspection, explicitChannels = null) {
  if (Array.isArray(explicitChannels) && explicitChannels.length) {
    const channels = [...new Set(explicitChannels.map(normalizeToken))];
    const unknown = channels.filter(channel => !KNOWN.has(channel));
    return {
      source: 'user-provided',
      confidence: unknown.length ? 'medium' : 'high',
      channels,
      unknown,
      protectedSettingsReadOnly: true,
      blockers: unknown.length ? [`Unknown channel tokens require review: ${unknown.join(', ')}`] : []
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
      const token = normalizeToken(candidate);
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
