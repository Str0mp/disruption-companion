// Superficie HTTP como handler estándar Request → Response, sin framework ni dependencia del runtime.
// Corre igual en Node (server.ts) y en Cloudflare Workers (worker.ts). Rutas:
//   GET  /health
//   POST /bookings/:id/assessment   { compensation_requested?: boolean, now?: ISO }  → evaluación (vista interna) + vista del pasajero
//   POST /bookings/:id/rebooking    { option_id, idempotency_key }                   → 201 | 200 (ya solicitado) | 202 (indeterminado → caso humano)
//   GET  /_debug/mock               estado de las tools de escritura en memoria (solo demo)

import { assess, executeAssessment } from '../domain/assess.ts';
import { toPassengerView } from '../domain/passengerView.ts';
import type { MockTools } from '../tools/mocks.ts';
import type { Tools } from '../tools/contracts.ts';

const SAMPLE_NOW = '2026-09-15T11:02:37Z'; // reloj de demo: 2 s después de recuperar las opciones de ejemplo

export type App = (req: Request) => Promise<Response>;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'el cuerpo no es JSON válido'); }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export function createApp(tools: Tools, mock?: MockTools): App {
  return async (req) => {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });

      if (req.method === 'GET' && url.pathname === '/') {
        return json(200, { service: 'disruption-companion', try: 'POST /bookings/ABC123/assessment', repo: 'https://github.com/Str0mp/disruption-companion' });
      }

      if (req.method === 'GET' && url.pathname === '/_debug/mock' && mock) {
        return json(200, { rebookings: [...mock.rebookings.entries()], human_cases: mock.humanCases, notifications: mock.notifications });
      }

      if (parts[0] === 'bookings' && parts[1] && parts[2] === 'assessment' && req.method === 'POST') {
        const body = await readJson(req);
        const a = await executeAssessment(tools, {
          bookingId: parts[1],
          compensationRequested: body.compensation_requested === true,
          now: typeof body.now === 'string' ? body.now : SAMPLE_NOW,
        });
        if ('error' in a) return json(404, a);
        return json(200, { passenger_view: toPassengerView(a), assessment: a });
      }

      if (parts[0] === 'bookings' && parts[1] && parts[2] === 'rebooking' && req.method === 'POST') {
        const body = await readJson(req);
        const optionId = body.option_id;
        const key = body.idempotency_key;
        if (typeof optionId !== 'string' || typeof key !== 'string' || key.length < 8) {
          return json(400, { error: 'VALIDATION', detail: 'se requieren option_id (string) e idempotency_key (string, >= 8 caracteres)' });
        }
        // Se vuelve a evaluar para validar la opción contra datos actuales; nunca se confía en lo que manda el cliente.
        const a = await assess(tools, { bookingId: parts[1], now: typeof body.now === 'string' ? body.now : SAMPLE_NOW });
        if ('error' in a) return json(404, a);
        const verdict = a.decision.options.find((o) => o.option_id === optionId);
        if (!verdict || !verdict.viable || a.decision.blockers.length > 0) {
          return json(422, { error: 'OPTION_NOT_ELIGIBLE', option_id: optionId, reasons: verdict?.reasons ?? ['opción desconocida'], blockers: a.decision.blockers });
        }
        const trip = await tools.getTripContext(parts[1]);
        const option = (await tools.getEligibleOptions(trip!)).options.find((o) => o.option_id === optionId)!;
        const result = await tools.createRebookingRequest(option, key);
        if (result.status === 201) return json(201, { request_id: result.request_id, status: result.state, expires_at: result.expires_at, next: 'el pasajero debe confirmar' });
        if (result.status === 409) return json(200, { request_id: result.request_id, status: 'ALREADY_REQUESTED' });
        // 503: resultado desconocido. No se reintenta a ciegas; una persona verifica.
        const hc = await tools.createHumanCase({ reason: 'REBOOKING_INDETERMINATE', evidence: { booking_id: parts[1], option_id: optionId, idempotency_key: key } });
        return json(202, { status: 'INDETERMINATE', detail: 'el sistema de reservas no respondió; una persona verificará antes de cualquier reintento', case_id: hc.case_id, sla_minutes: hc.sla_minutes });
      }

      return json(404, { error: 'NOT_FOUND' });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return json(status, { error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', detail: (err as Error).message });
    }
  };
}
