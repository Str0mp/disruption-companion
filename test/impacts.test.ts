import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImpacts } from '../src/domain/impacts.ts';
import { stripPii } from '../src/domain/pii.ts';
import { PEDRO, delay, trip } from './helpers.ts';

test('A1: María — 160 min de retraso en S1 implica perder la conexión S2', () => {
  const { segments, impacts } = detectImpacts(stripPii(trip()), [delay('S1', 160)]);
  assert.equal(segments[0]?.estimated_arrival, '2026-09-15T20:35');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0]?.type, 'MISSED_CONNECTION');
  assert.equal((impacts[0] as { margin_minutes: number }).margin_minutes, -90);
});

test('A1: Pedro — 20 min de retraso en un vuelo directo no es una modificación relevante', () => {
  const { impacts } = detectImpacts(stripPii(PEDRO), [delay('S1', 20)]);
  assert.deepEqual(impacts, []);
});

test('A1: 40 min de retraso dejan 30 min de conexión → en riesgo con el supuesto de 60, bien con 20', () => {
  const t = stripPii(trip());
  assert.equal(detectImpacts(t, [delay('S1', 40)]).impacts[0]?.type, 'CONNECTION_AT_RISK');
  assert.deepEqual(detectImpacts(t, [delay('S1', 40)], { minConnectionMinutes: 20 }).impacts, []);
});

test('A1: un cambio de puerta solo no produce impacto', () => {
  const { impacts } = detectImpacts(stripPii(trip()), [{ event_id: 'G', segment_id: 'S1', type: 'GATE_CHANGE', gate: '24', source: 'AIRPORT_FEED', recorded_at: '2026-09-15T10:55:00Z' }]);
  assert.deepEqual(impacts, []);
});
