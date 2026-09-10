#!/usr/bin/env node
import { createDashboardRuntime } from './runtime.js';

const { config, server } = createDashboardRuntime();
server.listen(config.dashboard.port, config.dashboard.host, () => {
  console.log(`Dynamic Denon Tuning dashboard: http://${config.dashboard.host}:${config.dashboard.port}`);
  console.log('Mode: guided automatic calibration, native post-correction proof is hardware-unverified.');
});
