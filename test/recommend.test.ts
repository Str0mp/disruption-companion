import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/domain/recommend.ts';
import { stripPii } from '../src/domain/pii.ts';
import type { RuleEvaluation } from '../src/domain/policy.ts';
import { SAMPLE_NOW } from '../src/tools/fixtures.ts';
import { options, trip } from './helpers.ts';

const R3: RuleEvaluation = { rule_id: 'R3', condition: 'missed_connection == true', entitlement: 'REBOOK_NO_FEE', requires_human_approval: false, outcome: 'APPLIES', unknown_variables: [] };
const R5: RuleEvaluation = { rule_id: 'R5', condition: 'group_includes_minor == true', entitlement: 'PRIORITY_HANDLING', requires_human_approval: true, outcome: 'APPLIES', unknown_variables: [] };

test('A3: O1 se recomienda automáticamente; O2 falla por asientos, cobro y confianza; O3 por confianza y tarifa', () => {
  const r = recommend({ trip: stripPii(trip()), applied: [R3, R5], uncertain: [], options: options(), now: SAMPLE_NOW });
  assert.equal(r.automatic, true);
  assert.equal(r.recommendation?.option.option_id, 'O1');
  assert.deepEqual(r.recommendation?.based_on_rules, ['R3']);
  const o2 = r.options.find((o) => o.option_id === 'O2')!;
  assert.equal(o2.viable, false);
  assert.ok(o2.reasons.some((x) => x.includes('1 asiento(s) para 2 pasajero(s)')));
  assert.ok(o2.reasons.some((x) => x.includes('REBOOK_NO_FEE')));
  assert.ok(o2.reasons.some((x) => x.includes('MEDIUM')));
  const o3 = r.options.find((o) => o.option_id === 'O3')!;
  assert.ok(o3.reasons.some((x) => x.includes('no es reembolsable')));
});

test('A3: el change_penalty_amount faltante es irrelevante cuando el cambio es gratis', () => {
  const r = recommend({ trip: stripPii(trip()), applied: [R3], uncertain: [], options: options(), now: SAMPLE_NOW });
  assert.deepEqual(r.blockers, []);
});

test('A3: opciones expiradas → sin recomendación automática', () => {
  const r = recommend({ trip: stripPii(trip()), applied: [R3], uncertain: [], options: options(), now: '2026-09-15T11:05:00Z' });
  assert.equal(r.recommendation, null);
  assert.ok(r.options.every((o) => o.reasons.some((x) => x.includes('expiraron'))));
});

test('A3: un hecho incierto bloquea cualquier recomendación aunque una opción parezca viable', () => {
  const r = recommend({ trip: stripPii(trip()), applied: [R3], uncertain: [{ segment_id: 'S1', claims: [] }], options: options(), now: SAMPLE_NOW });
  assert.equal(r.recommendation, null);
  assert.equal(r.blockers[0]?.check, 'SOURCES_AGREE');
  assert.equal(r.options.find((o) => o.option_id === 'O1')?.viable, true);
});
