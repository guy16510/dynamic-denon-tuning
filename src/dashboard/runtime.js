import { loadConfig } from '../config.js';
import { EvoBurrowAdapter } from '../adapters/evoburrow.js';
import { DenonAdapter } from '../adapters/denon.js';
import { RewV2Adapter } from '../adapters/rew-v2.js';
import { ShieldAdapter } from '../adapters/shield.js';
import { NexusAdapter } from '../adapters/nexus.js';
import { SessionStore } from '../lib/session-store.js';
import { MeasurementService } from '../services/measurement-service.js';
import { TheaterService } from '../services/theater-service.js';
import { LiveEventBus } from '../services/live-event-bus.js';
import { V2EventStore } from '../services/v2-event-store.js';
import { CalibrationStateMachine } from '../services/calibration-state-machine.js';
import { CalibrationV2Service } from '../services/calibration-v2-service.js';
import { createDashboardServer } from './server.js';

export function createDashboardRuntime(config = loadConfig()) {
  const sessions = new SessionStore(config.sessionsDir);
  const evoburrow = new EvoBurrowAdapter(config.evoburrow);
  const denon = new DenonAdapter(config.denon, evoburrow);
  const rew = new RewV2Adapter(config.rew, evoburrow);
  const shield = new ShieldAdapter(config.shield);
  const nexus = new NexusAdapter(config.nexus);
  const measurement = new MeasurementService({ rew, shield, denon, sessions });
  const theater = new TheaterService({ config, evoburrow, denon, rew, shield, nexus, measurement, sessions });
  const bus = new LiveEventBus();
  const events = new V2EventStore({ sessions, bus });
  const stateMachine = new CalibrationStateMachine({ events });
  const service = new CalibrationV2Service({ config, sessions, events, stateMachine, theater, denon, shield });
  const server = createDashboardServer({ config, service, theater, bus });
  return { config, server, service, bus, events, stateMachine };
}
