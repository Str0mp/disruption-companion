// Superficie HTTP mínima, sin framework. Rutas:
//   GET  /health
//   POST /bookings/:id/assessment   { compensation_requested?: boolean, now?: ISO }  → evaluación (vista interna) + vista del pasajero
//   POST /bookings/:id/rebooking    { option_id, idempotency_key }                   → 201 | 200 (ya solicitado) | 202 (indeterminado → caso humano)
//   GET  /_debug/mock               estado de las tools de escritura en memoria (solo demo)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { assess, executeAssessment } from '../domain/assess.ts';
import { toPassengerView } from '../domain/passengerView.ts';
import { MockTools } from '../tools/mocks.ts';
import type { Tools } from '../tools/contracts.ts';

const SAMPLE_NOW = '2026-09-15T11:02:37Z'; // reloj de demo: 2 s después de recuperar las opciones de ejemplo

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('el cuerpo no es JSON válido'), { status: 400 }); }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

export function makeHandler(tools: Tools, mock?: MockTools) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

      if (req.method === 'GET' && url.pathname === '/_debug/mock' && mock) {
        return send(res, 200, { rebookings: [...mock.rebookings.entries()], human_cases: mock.humanCases, notifications: mock.notifications });
      }

      if (parts[0] === 'bookings' && parts[1] && parts[2] === 'assessment' && req.method === 'POST') {
        const body = await readJson(req);
        const a = await executeAssessment(tools, {
          bookingId: parts[1],
          compensationRequested: body.compensation_requested === true,
          now: typeof body.now === 'string' ? body.now : SAMPLE_NOW,
        });
        if ('error' in a) return send(res, 404, a);
        return send(res, 200, { passenger_view: toPassengerView(a), assessment: a });
      }

      if (parts[0] === 'bookings' && parts[1] && parts[2] === 'rebooking' && req.method === 'POST') {
        const body = await readJson(req);
        const optionId = body.option_id;
        const key = body.idempotency_key;
        if (typeof optionId !== 'string' || typeof key !== 'string' || key.length < 8) {
          return send(res, 400, { error: 'VALIDATION', detail: 'se requieren option_id (string) e idempotency_key (string, >= 8 caracteres)' });
        }
        // Se vuelve a evaluar para validar la opción contra datos actuales; nunca se confía en lo que manda el cliente.
        const a = await assess(tools, { bookingId: parts[1], now: typeof body.now === 'string' ? body.now : SAMPLE_NOW });
        if ('error' in a) return send(res, 404, a);
        const verdict = a.decision.options.find((o) => o.option_id === optionId);
        if (!verdict || !verdict.viable || a.decision.blockers.length > 0) {
          return send(res, 422, { error: 'OPTION_NOT_ELIGIBLE', option_id: optionId, reasons: verdict?.reasons ?? ['opción desconocida'], blockers: a.decision.blockers });
        }
        const option = (await tools.getEligibleOptions((await tools.getTripContext(parts[1]))!)).options.find((o) => o.option_id === optionId)!;
        const result = await tools.createRebookingRequest(option, key);
        if (result.status === 201) return send(res, 201, { request_id: result.request_id, status: result.state, expires_at: result.expires_at, next: 'el pasajero debe confirmar' });
        if (result.status === 409) return send(res, 200, { request_id: result.request_id, status: 'ALREADY_REQUESTED' });
        // 503: resultado desconocido. No se reintenta a ciegas; una persona verifica.
        const hc = await tools.createHumanCase({ reason: 'REBOOKING_INDETERMINATE', evidence: { booking_id: parts[1], option_id: optionId, idempotency_key: key } });
        return send(res, 202, { status: 'INDETERMINATE', detail: 'el sistema de reservas no respondió; una persona verificará antes de cualquier reintento', case_id: hc.case_id, sla_minutes: hc.sla_minutes });
      }

      return send(res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return send(res, status, { error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', detail: (err as Error).message });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mock = new MockTools();
  const port = Number(process.env.PORT ?? 3000);
  createServer(makeHandler(mock, mock)).listen(port, () => console.log(`disruption-companion escuchando en :${port}`));
}
