import test from 'node:test';
import assert from 'node:assert/strict';
import { CalibrationStateMachine, canTransition } from '../src/services/calibration-state-machine.js';

test('calibration state machine rejects impossible state jumps', async () => {
  const history = [];
  const events = { read: async () => history, append: async (sessionId, type, data) => history.push({ sessionId, type, data }) };
  const machine = new CalibrationStateMachine({ events });
  assert.equal(canTransition('CREATED', 'COMPLETE'), false);
  await machine.transition('s1', 'PREFLIGHT');
  await assert.rejects(machine.transition('s1', 'COMPLETE'), /invalid calibration state transition/);
  await machine.transition('s1', 'BLOCKED');
  assert.equal(await machine.state('s1'), 'BLOCKED');
});
