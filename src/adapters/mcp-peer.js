import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function parseResult(result) {
  const text = result?.content?.find?.(entry => entry.type === 'text')?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return { text }; }
}

export class McpPeer {
  constructor({ command, args = [], env = process.env, name = 'dynamic-denon-tuning-peer' }) {
    this.spec = { command, args, env };
    this.name = name;
    this.client = null;
    this.transport = null;
    this.toolNames = new Set();
  }

  async connect() {
    if (this.client) return;
    this.client = new Client({ name: this.name, version: '0.1.0' });
    this.transport = new StdioClientTransport(this.spec);
    await this.client.connect(this.transport);
    const { tools } = await this.client.listTools();
    this.toolNames = new Set(tools.map(tool => tool.name));
  }

  hasTool(name) {
    return this.toolNames.has(name);
  }

  async call(name, args = {}, options = {}) {
    await this.connect();
    if (!this.hasTool(name)) throw new Error(`peer MCP does not expose required tool: ${name}`);
    const result = await this.client.callTool({ name, arguments: args }, options);
    const parsed = parseResult(result);
    if (result?.isError) {
      const message = parsed?.error || parsed?.message || parsed?.text || `peer tool failed: ${name}`;
      const error = new Error(message);
      error.tool = name;
      error.result = parsed;
      throw error;
    }
    return parsed;
  }

  async close() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.transport = null;
    this.toolNames.clear();
  }
}
