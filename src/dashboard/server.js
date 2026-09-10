import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${JSON.stringify(value)}\n`);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (Buffer.byteLength(text) > 1_000_000) throw new Error('request body too large');
  return JSON.parse(text);
}

function matchSession(pathname, suffix = '') {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pathname.match(new RegExp(`^/api/sessions/([^/]+)${escaped}$`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function serveStatic(res, pathname, staticDir) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const target = resolve(staticDir, relative);
  if (!target.startsWith(`${resolve(staticDir)}/`) && target !== resolve(staticDir, 'index.html')) return false;
  let file = target;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch { return false; }
  const content = await readFile(file);
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(content);
  return true;
}

export function createDashboardServer({ config, service, theater, bus, staticDir = join(process.cwd(), 'web', 'dist') }) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/api/system') return json(res, 200, { receiver: 'Denon AVR-X3700H', protectedPreset: 1, candidatePreset: 2, receiverWritesEnabled: config.denon.allowWrites, nativeMeasurementMode: config.calibration.nativeMeasurement, productMode: 'guided-automatic-calibration' });
      if (req.method === 'GET' && path === '/api/theater') return json(res, 200, await theater.inspect());
      if (req.method === 'GET' && path === '/api/sessions') return json(res, 200, await service.listSessions());
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        const unsubscribe = bus.subscribe(event => res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        req.on('close', unsubscribe);
        return;
      }
      const eventsId = matchSession(path, '/events');
      if (req.method === 'GET' && eventsId) return json(res, 200, await service.eventsFor(eventsId));
      const measurementsId = matchSession(path, '/measurements');
      if (req.method === 'GET' && measurementsId) return json(res, 200, await service.measurementsFor(measurementsId));
      const candidatesId = matchSession(path, '/candidates');
      if (req.method === 'GET' && candidatesId) return json(res, 200, await service.candidatesFor(candidatesId));
      const championId = matchSession(path, '/champion');
      if (req.method === 'GET' && championId) return json(res, 200, (await service.status(championId)).champion);
      const sessionId = matchSession(path);
      if (req.method === 'GET' && sessionId) return json(res, 200, await service.status(sessionId));
      if (req.method === 'POST' && path === '/api/calibration/start') {
        const input = await body(req);
        const created = input.sessionId ? null : await service.create({ profilePath: input.profilePath, sourceAdy: input.sourceAdy });
        const id = input.sessionId || created.id;
        return json(res, 200, await service.start({ sessionId: id }));
      }
      const command = path.match(/^\/api\/calibration\/([^/]+)\/(pause|resume|abort|apply-best)$/);
      if (req.method === 'POST' && command) {
        const session = decodeURIComponent(command[1]);
        const method = command[2] === 'apply-best' ? 'applyBest' : command[2];
        return json(res, 200, await service[method]({ sessionId: session }));
      }
      if (req.method === 'GET' && !path.startsWith('/api/')) {
        if (await serveStatic(res, path, staticDir)) return;
        if (await serveStatic(res, '/', staticDir)) return;
      }
      json(res, 404, { error: 'not found' });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
  return server;
}
