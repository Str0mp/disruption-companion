// A3 — Cuándo una recomendación puede entregarse automáticamente.
// Solo cuando pasan todos los chequeos. Los chequeos de hecho bloquean cualquier recomendación;
// los chequeos de opción rechazan opciones individuales. Si nada sobrevive, el sistema
// informa lo cierto y deriva; nunca promete lo que no puede verificar.

import type { UncertainFact } from './events.ts';
import type { RuleEvaluation } from './policy.ts';
import type { Option, OptionsResponse, TripForDecision } from './types.ts';

export type Blocker =
  | { check: 'SOURCES_AGREE'; detail: string }
  | { check: 'MISSING_DATA_IRRELEVANT'; detail: string }
  | { check: 'NO_HUMAN_APPROVAL_NEEDED'; detail: string };

export type OptionVerdict = { option_id: string; type: Option['type']; viable: boolean; reasons: string[] };

export type Recommendation = {
  option: Option;
  policy_ref: string;
  based_on_rules: string[];
  expires_at: string;
};

export type RecommendOutcome = {
  recommendation: Recommendation | null;
  automatic: boolean;
  blockers: Blocker[];
  options: OptionVerdict[];
};

export type RecommendInput = {
  trip: TripForDecision;
  applied: RuleEvaluation[];
  uncertain: UncertainFact[];
  options: OptionsResponse;
  now: string; // ISO
};

/** Campos cuya ausencia vuelve insegura la decisión, sea cual sea el derecho. */
const ALWAYS_REQUIRED_PREFIXES = ['segments', 'passengers', 'fare_conditions.changeable', 'fare_conditions.refundable'];

export function recommend(input: RecommendInput): RecommendOutcome {
  const { trip, applied, uncertain, options, now } = input;
  const blockers: Blocker[] = [];

  const noFeeRules = applied.filter((r) => r.entitlement === 'REBOOK_NO_FEE');
  const autoNoFee = noFeeRules.filter((r) => !r.requires_human_approval);

  if (uncertain.length > 0) {
    blockers.push({ check: 'SOURCES_AGREE', detail: `fuentes confiables discrepan sobre el/los segmento(s) ${uncertain.map((u) => u.segment_id).join(', ')}` });
  }

  const missing = trip._meta.missing_fields ?? [];
  const relevantMissing = missing.filter((f) => {
    if (ALWAYS_REQUIRED_PREFIXES.some((p) => f.startsWith(p))) return true;
    if (f === 'fare_conditions.change_penalty_amount') return autoNoFee.length === 0; // irrelevante cuando el cambio es gratis
    return false;
  });
  if (relevantMissing.length > 0) {
    blockers.push({ check: 'MISSING_DATA_IRRELEVANT', detail: `faltan campos que afectan esta decisión: ${relevantMissing.join(', ')}` });
  }

  if (noFeeRules.length > 0 && autoNoFee.length === 0) {
    blockers.push({ check: 'NO_HUMAN_APPROVAL_NEEDED', detail: `el derecho a cambio solo viene de reglas que exigen aprobación humana: ${noFeeRules.map((r) => r.rule_id).join(', ')}` });
  }

  const expiresAt = new Date(Date.parse(options._meta.retrieved_at) + options._meta.ttl_seconds * 1000).toISOString();
  const expired = Date.parse(now) >= Date.parse(expiresAt);
  const pax = trip.passengers.length;

  const verdicts: OptionVerdict[] = options.options.map((o) => {
    const reasons: string[] = [];
    if (o.confidence !== 'HIGH') reasons.push(`confianza ${o.confidence}, se exige HIGH`);
    if (expired) reasons.push(`las opciones expiraron a las ${expiresAt}`);
    if (o.type === 'REBOOK') {
      if (autoNoFee.length === 0) reasons.push('no hay derecho automático REBOOK_NO_FEE');
      if (o.seats_available === undefined) reasons.push('seats_available desconocido');
      else if (o.seats_available < pax) reasons.push(`solo ${o.seats_available} asiento(s) para ${pax} pasajero(s)`);
      if (o.fare_difference === undefined) reasons.push('fare_difference desconocido');
      else if (o.fare_difference > 0 && autoNoFee.length > 0) reasons.push(`cobra ${o.fare_difference} ${o.currency ?? ''} pero el derecho es REBOOK_NO_FEE`.replace('  ', ' '));
    } else if (o.type === 'REFUND') {
      if (!trip.fare_conditions.refundable) reasons.push('la tarifa no es reembolsable');
    }
    return { option_id: o.option_id, type: o.type, viable: reasons.length === 0, reasons };
  });

  const viable = options.options
    .filter((o) => verdicts.find((v) => v.option_id === o.option_id)?.viable)
    .sort((a, b) => `${a.date ?? ''}${a.departure ?? ''}`.localeCompare(`${b.date ?? ''}${b.departure ?? ''}`));

  const chosen = blockers.length === 0 ? viable[0] ?? null : null;
  const recommendation: Recommendation | null = chosen
    ? { option: chosen, policy_ref: chosen.policy_ref, based_on_rules: autoNoFee.map((r) => r.rule_id), expires_at: expiresAt }
    : null;

  return { recommendation, automatic: recommendation !== null, blockers, options: verdicts };
}
