#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { analyzeNormalizedCapture } from './analyze-capture.js';

export function compareCaptures(aText, bText) {
  const a = analyzeNormalizedCapture(aText);
  const b = analyzeNormalizedCapture(bText);
  const toMap = result => new Map(result.signatures.map(item => [item.signature, item.count]));
  const am = toMap(a), bm = toMap(b);
  const keys = [...new Set([...am.keys(), ...bm.keys()])].sort();
  return {
    aPackets: a.packetCount,
    bPackets: b.packetCount,
    differences: keys.map(signature => ({ signature, a: am.get(signature) || 0, b: bm.get(signature) || 0 })).filter(item => item.a !== item.b)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [aPath, bPath] = process.argv.slice(2);
  if (!aPath || !bPath) {
    console.error('Usage: node tools/audyssey-protocol/compare-captures.js experiment-a.jsonl experiment-b.jsonl');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(compareCaptures(await readFile(aPath, 'utf8'), await readFile(bPath, 'utf8')), null, 2));
  }
}
