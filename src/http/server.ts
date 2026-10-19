// Adaptador Node: convierte node:http en Request/Response estándar y delega en la app.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createApp, type App } from './app.ts';
import { MockTools } from '../tools/mocks.ts';

export function nodeHandler(app: App) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const hasBody = chunks.length > 0 && method !== 'GET' && method !== 'HEAD';
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    const response = await app(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = new MockTools();
  const port = Number(process.env.PORT ?? 3000);
  createServer(nodeHandler(createApp(mock, mock))).listen(port, () => console.log(`disruption-companion escuchando en :${port}`));
}
