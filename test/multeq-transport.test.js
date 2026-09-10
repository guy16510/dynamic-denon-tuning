import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualMultEqTransport } from '../src/transports/multeq-transport.js';

test('manual MultEQ transport is an explicit Preset 2 checkpoint, not fake automation', async () => {
  const transport = new ManualMultEqTransport();
  const result = await transport.transfer({ candidatePath: '/tmp/candidate.ady', targetPreset: 2 });
  assert.equal(result.checkpoint, true);
  await assert.rejects(transport.transfer({ candidatePath: '/tmp/candidate.ady', targetPreset: 1 }), /Preset 2/);
});
