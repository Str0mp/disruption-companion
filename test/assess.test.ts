import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, executeAssessment } from '../src/domain/assess.ts';
import { toPassengerView } from '../src/domain/passengerView.ts';
import { MockTools } from '../src/tools/mocks.ts';
import { SAMPLE_NOW } from '../src/tools/fixtures.ts';
import { PEDRO, delay, events } from './helpers.ts';

test('caso base ABC123: conexión perdida → R3 cambio sin costo, O1 recomendada, caso humano por R5 en paralelo, pasajero notificado', async () => {
  const mock = new MockTools();
  const a = await executeAssessment(mock, { bookingId: 'ABC123', now: SAMPLE_NOW });
  assert.ok(!('error' in a));
  if ('error' in a) return;
  assert.equal(a.relevant, true);
  assert.equal(a.impacts[0]?.type, 'MISSED_CONNECTION');
  assert.deepEqual(a.policy.applied.map((r) => r.rule_id), ['R3', 'R5']);
  assert.equal(a.decision.recommendation?.option.option_id, 'O1');
  assert.equal(a.decision.automatic, true);
  assert.equal(a.handoff.required, true);
  assert.equal(a.handoff.blocks_communication, false);
  assert.deepEqual(a.handoff.reasons.map((r) => r.rule_id), ['R5']);
  assert.equal(a.human_case?.queue, 'DISRUPTION_L2');
  assert.equal(mock.humanCases.length, 1);
  assert.equal(mock.notifications.length, 1);
  assert.equal(mock.notifications[0]?.policy_ref, 'POL-DELAY-2026-03');
  assert.equal(a.events.discarded.find((d) => d.event_id === 'E-1012')?.reason, 'SOURCE_DEGRADED');
});

test('A2: la vista del pasajero no contiene datos internos ni datos personales', async () => {
  const mock = new MockTools();
  const a = await assess(mock, { bookingId: 'ABC123', now: SAMPLE_NOW });
  if ('error' in a) throw new Error('inesperado');
  const view = JSON.stringify(toPassengerView(a));
  for (const forbidden of ['OPS_CORE', 'LEGACY_MIRROR', 'AIRPORT_FEED', 'confidence', 'HIGH', 'MEDIUM', 'LOW', '"R3"', 'R5', 'missing', 'degradad', '12.345.678-9', 'maria.silva', '+56', 'María', 'Tomás']) {
    assert.ok(!view.includes(forbidden), `la vista del pasajero filtra "${forbidden}"`);
  }
  const v = toPassengerView(a);
  assert.equal(v.status, 'DISRUPTED');
  assert.equal(v.recommendation?.flight_number, 'LA2412');
  assert.equal(v.agent_follow_up, true);
});

test('A2: el motor de decisión nunca recibe datos personales', async () => {
  const mock = new MockTools();
  const a = await assess(mock, { bookingId: 'ABC123', now: SAMPLE_NOW });
  if ('error' in a) throw new Error('inesperado');
  const internal = JSON.stringify(a);
  for (const pii of ['12.345.678-9', 'maria.silva@example.com', '+56 9', 'María Silva']) assert.ok(!internal.includes(pii), `la evaluación contiene el dato personal "${pii}"`);
});

test('Pedro: 20 min de retraso en vuelo directo → no relevante, nada escrito, sin notificación', async () => {
  const mock = new MockTools({ trips: { PEDRO1: PEDRO }, events: { PEDRO1: events([delay('S1', 20)]) } });
  const a = await executeAssessment(mock, { bookingId: 'PEDRO1', now: SAMPLE_NOW });
  if ('error' in a) throw new Error('inesperado');
  assert.equal(a.relevant, false);
  assert.equal(a.handoff.required, false);
  assert.equal(mock.humanCases.length, 0);
  assert.equal(mock.notifications.length, 0);
  assert.equal(toPassengerView(a).status, 'NO_RELEVANT_CHANGE');
});

test('A4/A5: fuentes confiables en conflicto → caso humano, comunicación bloqueada, el pasajero ve UNDER_REVIEW', async () => {
  const mock = new MockTools({
    events: { ABC123: events([delay('S1', 160), { event_id: 'E-C', segment_id: 'S1', type: 'CANCELLATION', source: 'AIRPORT_FEED', recorded_at: '2026-09-15T10:50:00Z' }]) },
  });
  const a = await executeAssessment(mock, { bookingId: 'ABC123', now: SAMPLE_NOW });
  if ('error' in a) throw new Error('inesperado');
  assert.equal(a.handoff.blocks_communication, true);
  assert.ok(a.handoff.reasons.some((r) => r.code === 'FACT_UNCERTAIN'));
  assert.equal(mock.humanCases.length, 1);
  assert.equal(mock.notifications.length, 0);
  assert.equal(toPassengerView(a).status, 'UNDER_REVIEW');
});

test('A4: compensación en efectivo solicitada → derivación por R4, pero lo cierto (cambio por R3) igual se comunica', async () => {
  const mock = new MockTools();
  const a = await executeAssessment(mock, { bookingId: 'ABC123', now: SAMPLE_NOW, compensationRequested: true });
  if ('error' in a) throw new Error('inesperado');
  assert.ok(a.handoff.reasons.some((r) => r.rule_id === 'R4'));
  assert.equal(a.decision.recommendation?.option.option_id, 'O1');
  assert.equal(mock.notifications.length, 1);
});

test('reserva desconocida → BOOKING_NOT_FOUND', async () => {
  const a = await assess(new MockTools(), { bookingId: 'NOPE' });
  assert.deepEqual(a, { error: 'BOOKING_NOT_FOUND', booking_id: 'NOPE' });
});
