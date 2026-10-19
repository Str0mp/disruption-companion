import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFacts, evaluateCondition, evaluatePolicy } from '../src/domain/policy.ts';
import { detectImpacts } from '../src/domain/impacts.ts';
import { stripPii } from '../src/domain/pii.ts';
import { POLICY_DELAY } from '../src/tools/fixtures.ts';
import { PEDRO, delay, trip } from './helpers.ts';

function outcome(ruleId: string, o: ReturnType<typeof evaluatePolicy>) {
  return o.evaluations.find((e) => e.rule_id === ruleId)?.outcome;
}

test('política: María obtiene REBOOK_NO_FEE por R3 (conexión perdida), no por R1 (160 < 180)', () => {
  const t = stripPii(trip());
  const { segments, impacts } = detectImpacts(t, [delay('S1', 160)]);
  const o = evaluatePolicy(POLICY_DELAY, deriveFacts(t, segments, impacts, false));
  assert.equal(outcome('R1', o), 'DOES_NOT_APPLY');
  assert.equal(outcome('R3', o), 'APPLIES');
  assert.equal(outcome('R5', o), 'APPLIES'); // menor en el grupo → aprobación humana
  assert.equal(outcome('R4', o), 'DOES_NOT_APPLY');
  assert.equal(outcome('R2', o), 'DOES_NOT_APPLY');
});

test('política: Ana — 240 min en un vuelo directo internacional recibe voucher (R2) y R1', () => {
  const t = stripPii(PEDRO);
  const { segments, impacts } = detectImpacts(t, [delay('S1', 240)]);
  const o = evaluatePolicy(POLICY_DELAY, deriveFacts(t, segments, impacts, false));
  assert.equal(outcome('R1', o), 'APPLIES');
  assert.equal(outcome('R2', o), 'APPLIES');
  assert.equal(outcome('R3', o), 'DOES_NOT_APPLY');
});

test('política: una variable desconocida deja la regla INDETERMINABLE solo si ninguna otra cláusula ya falla', () => {
  assert.equal(evaluateCondition('delay_minutes >= 240 AND international', { delay_minutes: 300 }).outcome, 'UNDETERMINABLE');
  assert.equal(evaluateCondition('delay_minutes >= 240 AND international', { delay_minutes: 100 }).outcome, 'DOES_NOT_APPLY');
  assert.equal(evaluateCondition('missed_connection == true', { missed_connection: true }).outcome, 'APPLIES');
});
