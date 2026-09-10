#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 16); }

export function analyzeNormalizedCapture(text) {
  const packets = text.split('\n').filter(Boolean).map((line, index) => {
    let packet;
    try { packet = JSON.parse(line); } catch { throw new Error(`line ${index + 1} is not valid JSON`); }
    if (!packet.direction || !Number.isFinite(Number(packet.length))) throw new Error(`line ${index + 1} requires direction and numeric length`);
    const payload = packet.payloadHex ? Buffer.from(String(packet.payloadHex).replace(/[^a-fA-F0-9]/g, ''), 'hex') : Buffer.alloc(0);
    return {
      index: index + 1,
      direction: packet.direction,
      srcPort: packet.srcPort ?? null,
      dstPort: packet.dstPort ?? null,
      length: Number(packet.length),
      payloadBytes: payload.length,
      payloadSignature: payload.length ? hash(payload) : null,
      timestamp: packet.timestamp ?? null
    };
  });
  const signatures = new Map();
  for (const packet of packets) {
    const key = `${packet.direction}|${packet.srcPort}|${packet.dstPort}|${packet.length}|${packet.payloadSignature}`;
    signatures.set(key, (signatures.get(key) || 0) + 1);
  }
  return {
    packetCount: packets.length,
    directions: Object.fromEntries([...new Set(packets.map(item => item.direction))].sort().map(direction => [direction, packets.filter(item => item.direction === direction).length])),
    signatures: [...signatures.entries()].map(([signature, count]) => ({ signature, count })).sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)),
    packets
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node tools/audyssey-protocol/analyze-capture.js normalized-capture.jsonl');
    process.exitCode = 2;
  } else {
    const result = analyzeNormalizedCapture(await readFile(path, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
  }
}
