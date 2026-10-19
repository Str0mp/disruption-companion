// A2 — Lo que ve el pasajero: solo lo necesario para entender y actuar.
// Sin fuentes, sin niveles de confianza, sin ids de reglas, sin nombres de campos faltantes, sin datos personales.
// Cada frase es un compromiso, por eso se genera únicamente desde una evaluación validada.

import type { Assessment } from './assess.ts';
import type { PassengerMessage } from '../tools/contracts.ts';

export type PassengerView = {
  booking_id: string;
  status: 'NO_RELEVANT_CHANGE' | 'DISRUPTED' | 'UNDER_REVIEW';
  headline: string;
  details: string[];
  entitlement?: string;
  recommendation?: { flight_number: string; date: string; departure: string; cost: string; valid_until: string; how_to_confirm: string };
  next_step: string;
  agent_follow_up: boolean;
  policy_reference?: string; // versión de la política aplicada, citable como términos y condiciones
};

function hhmm(iso: string): string { return iso.slice(11, 16); }

export function toPassengerView(a: Assessment): PassengerView {
  const base = { booking_id: a.booking_id, agent_follow_up: a.handoff.required };

  if (a.handoff.blocks_communication) {
    return { ...base, status: 'UNDER_REVIEW', headline: 'Estamos verificando el estado de tu vuelo.', details: [], next_step: 'Un agente te contactará en breve. No necesitas hacer nada por ahora.' };
  }

  const details: string[] = [];
  for (const s of a.segments) {
    if (s.status === 'DELAYED') details.push(`Tu vuelo ${s.flight_number} ${s.origin}–${s.destination} saldrá a las ${hhmm(s.estimated_departure)} (antes ${hhmm(s.scheduled_departure)}).`);
    if (s.status === 'CANCELLED') details.push(`Tu vuelo ${s.flight_number} ${s.origin}–${s.destination} fue cancelado.`);
    if (s.gate) details.push(`${s.flight_number} embarca por la puerta ${s.gate}.`);
  }

  if (!a.relevant) {
    return { ...base, status: 'NO_RELEVANT_CHANGE', headline: 'Tu viaje no tiene cambios que requieran acción.', details, next_step: 'Revisa la hora de salida antes de ir al aeropuerto.' };
  }

  const missed = a.impacts.find((i) => i.type === 'MISSED_CONNECTION');
  const atRisk = a.impacts.find((i) => i.type === 'CONNECTION_AT_RISK');
  const headline = missed ? 'Por el retraso no alcanzarás tu conexión.' : atRisk ? 'Tu conexión está ajustada por el retraso.' : 'Tu viaje tuvo un cambio importante.';

  const noFee = a.policy.applied.some((r) => r.entitlement === 'REBOOK_NO_FEE' && !r.requires_human_approval);
  const meal = a.policy.applied.some((r) => r.entitlement === 'MEAL_VOUCHER' && !r.requires_human_approval);
  const entitlements = [noFee ? 'cambiar tu vuelo sin costo' : null, meal ? 'recibir un voucher de alimentación' : null].filter(Boolean);
  const entitlement = entitlements.length ? `Según nuestra política de retrasos vigente, puedes ${entitlements.join(' y ')}.` : undefined;

  const rec = a.decision.recommendation;
  const recommendation = rec && rec.option.type === 'REBOOK'
    ? {
        flight_number: rec.option.flight_number ?? '',
        date: rec.option.date ?? '',
        departure: rec.option.departure ?? '',
        cost: (rec.option.fare_difference ?? 0) === 0 ? 'sin costo' : `${rec.option.fare_difference} ${rec.option.currency ?? ''}`.trim(),
        valid_until: rec.expires_at,
        how_to_confirm: 'Confirma desde la app o con un agente.',
      }
    : undefined;

  let next_step: string;
  if (recommendation) next_step = `Te recomendamos el vuelo ${recommendation.flight_number} del ${recommendation.date} a las ${recommendation.departure}, ${recommendation.cost}. ${recommendation.how_to_confirm}`;
  else next_step = 'Estamos buscando la mejor alternativa para ti. Un agente te contactará en breve.';
  if (a.handoff.required && recommendation) next_step += ' Además, un agente te contactará para asistirte.';

  return { ...base, status: 'DISRUPTED', headline, details, ...(entitlement ? { entitlement } : {}), ...(recommendation ? { recommendation } : {}), next_step, policy_reference: a.policy.version };
}

export function buildPassengerMessage(a: Assessment): PassengerMessage {
  const v = toPassengerView(a);
  const text = [v.headline, ...v.details, v.entitlement, v.next_step].filter(Boolean).join(' ');
  return { booking_id: a.booking_id, policy_ref: a.decision.recommendation?.policy_ref ?? a.policy.version, text };
}
