import { access } from 'node:fs/promises';
import { McpPeer } from './mcp-peer.js';
import { CapabilityError } from '../lib/errors.js';

export class EvoBurrowAdapter {
  constructor(config) {
    this.config = config;
    this.peer = null;
  }

  async connect() {
    if (this.peer) return this.peer;
    if (!this.config.serverPath) {
      throw new CapabilityError('EVOBURROW_SERVER is not configured', {
        remediation: 'Build EvoBurrow and set EVOBURROW_SERVER to dist/server.mjs.'
      });
    }
    await access(this.config.serverPath);
    this.peer = new McpPeer({
      command: process.execPath,
      args: [this.config.serverPath],
      env: {
        ...process.env,
        ...(this.config.home ? { A1_EVO_HOME: this.config.home } : {})
      },
      name: 'denon-atmos-autotune-evoburrow'
    });
    await this.peer.connect();
    return this.peer;
  }

  async status() {
    const peer = await this.connect();
    return {
      connected: true,
      tools: [...peer.toolNames].sort(),
      required: {
        denonSnapshot: peer.hasTool('denon_snapshot'),
        denonPlan: peer.hasTool('denon_propose_changes') && peer.hasTool('denon_execute_plan'),
        rewProbe: peer.hasTool('rew_probe'),
        rewTrace: peer.hasTool('rew_trace')
      }
    };
  }

  async call(name, args = {}, options) {
    return (await this.connect()).call(name, args, options);
  }

  async close() {
    await this.peer?.close();
    this.peer = null;
  }
}
