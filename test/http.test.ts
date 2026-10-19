import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeHandler } from '../src/http/server.ts';
import { MockTools, TIMEOUT_KEY_SUFFIX } from '../src/tools/mocks.ts';

const mock = new MockTools();
const server = createServer(makeHandler(mock, mock)).listen(0);
const base = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());

async function post(path: string, body: unknown) {
  const r = await fetch(base() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

test('POST /bookings/ABC123/assessment devuelve vista del pasajero + evaluación interna', async () => {
  const { status, body } = await post('/bookings/ABC123/assessment', {});
  assert.equal(status, 200);
  const view = body.passenger_view as { recommendation?: { flight_number: string } };
  assert.equal(view.recommendation?.flight_number, 'LA2412');
});

test('POST rebooking: 201 pendiente de confirmación, luego 409 mapeado a ALREADY_REQUESTED', async () => {
  const first = await post('/bookings/ABC123/rebooking', { option_id: 'O1', idempotency_key: 'abc123-o1-attempt-1' });
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'PENDING_CONFIRMATION');
  const again = await post('/bookings/ABC123/rebooking', { option_id: 'O1', idempotency_key: 'abc123-o1-attempt-1' });
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'ALREADY_REQUESTED');
  assert.equal(again.body.request_id, first.body.request_id);
});

test('POST rebooking: una opción no elegible se rechaza del lado del servidor', async () => {
  const r = await post('/bookings/ABC123/rebooking', { option_id: 'O2', idempotency_key: 'abc123-o2-attempt-1' });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'OPTION_NOT_ELIGIBLE');
});

test('POST rebooking: 503 del proveedor → sin reintento, caso humano, 202 INDETERMINATE', async () => {
  const before = mock.humanCases.length;
  const r = await post('/bookings/ABC123/rebooking', { option_id: 'O1', idempotency_key: `abc123-o1${TIMEOUT_KEY_SUFFIX}` });
  assert.equal(r.status, 202);
  assert.equal(r.body.status, 'INDETERMINATE');
  assert.equal(mock.humanCases.length, before + 1);
});

test('validación: falta la clave de idempotencia → 400', async () => {
  const r = await post('/bookings/ABC123/rebooking', { option_id: 'O1' });
  assert.equal(r.status, 400);
});
