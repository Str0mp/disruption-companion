// Orquestador. `assess` es pura sobre las tools de lectura; `executeAssessment` agrega los efectos
// decididos en A4 (abrir caso humano) y A2 (notificar solo contenido validado).

import type { ReadTools, Tools } from '../tools/contracts.ts';
import { resolveEvents, type DiscardedEvent, type UncertainFact } from './events.ts';
import { decideHandoff, type Handoff } from './handoff.ts';
import { DEFAULT_IMPACT_CONFIG, detectImpacts, type Impact, type ImpactConfig, type SegmentStatus } from './impacts.ts';
import { buildPassengerMessage } from './passengerView.ts';
import { stripPii } from './pii.ts';
import { deriveFacts, evaluatePolicy, type Facts, type PolicyOutcome } from './policy.ts';
import { recommend, type RecommendOutcome } from './recommend.ts';

export type AssessInput = {
  bookingId: string;
  compensationRequested?: boolean;
  now?: string; // ISO; por defecto el reloj del sistema
};

export type AssessConfig = { impact: ImpactConfig };
export const DEFAULT_CONFIG: AssessConfig = { impact: DEFAULT_IMPACT_CONFIG };

export type Assessment = {
  booking_id: string;
  assessed_at: string;
  relevant: boolean;
  segments: SegmentStatus[];
  impacts: Impact[];
  events: { effective: string[]; discarded: DiscardedEvent[]; uncertain: UncertainFact[]; sources_degraded: string[] };
  facts: Facts;
  policy: PolicyOutcome;
  decision: RecommendOutcome;
  handoff: Handoff;
  data_quality: { completeness: string; missing_fields: string[] };
  human_case?: { case_id: string; queue: string; sla_minutes: number };
  notification?: { notification_id: string; state: string } | { rejected: string };
};

export type AssessError = { error: 'BOOKING_NOT_FOUND'; booking_id: string };

export async function assess(tools: ReadTools, input: AssessInput, config: AssessConfig = DEFAULT_CONFIG): Promise<Assessment | AssessError> {
  const now = input.now ?? new Date().toISOString();
  const trip = await tools.getTripContext(input.bookingId);
  if (!trip) return { error: 'BOOKING_NOT_FOUND', booking_id: input.bookingId };

  const decisionTrip = stripPii(trip); // A2: el motor nunca retiene datos personales

  const eventsRes = await tools.getOperationalEvents(trip.segments.map((s) => s.segment_id));
  const resolved = resolveEvents(eventsRes); // A5
  const { segments, impacts } = detectImpacts(decisionTrip, resolved.effective, config.impact); // A1

  // SUPUESTO: solo se modela el escenario DELAY; una cancelación cargaría su propia política.
  const policyRules = await tools.getPolicyRules('DELAY');
  const facts = deriveFacts(decisionTrip, segments, impacts, input.compensationRequested ?? false);
  const policy = evaluatePolicy(policyRules, facts);

  // A1: relevante = hay un impacto, o un derecho que aplica sin aprobación.
  // Las reglas con aprobación (R4, R5) describen cómo tratar un caso, no si existe uno.
  const relevant = impacts.length > 0 || policy.applied.some((r) => !r.requires_human_approval);

  const options = relevant ? await tools.getEligibleOptions(trip) : { options: [], _meta: { retrieved_at: now, ttl_seconds: 0 } };
  const decision = recommend({ trip: decisionTrip, applied: policy.applied, uncertain: resolved.uncertain, options, now }); // A3
  const handoff = decideHandoff({ relevant, impacts, policy, recommend: decision }); // A4

  return {
    booking_id: trip.booking_id,
    assessed_at: now,
    relevant,
    segments,
    impacts,
    events: { effective: resolved.effective.map((e) => e.event_id), discarded: resolved.discarded, uncertain: resolved.uncertain, sources_degraded: eventsRes._meta.sources_degraded },
    facts,
    policy,
    decision,
    handoff,
    data_quality: { completeness: trip._meta.completeness, missing_fields: trip._meta.missing_fields },
  };
}

export async function executeAssessment(tools: Tools, input: AssessInput, config: AssessConfig = DEFAULT_CONFIG): Promise<Assessment | AssessError> {
  const a = await assess(tools, input, config);
  if ('error' in a) return a;

  if (a.handoff.required) {
    const hc = await tools.createHumanCase({
      reason: a.handoff.reasons.map((r) => r.code).join(','),
      evidence: {
        booking_id: a.booking_id,
        reasons: a.handoff.reasons,
        impacts: a.impacts,
        applied_rules: a.policy.applied.map((r) => r.rule_id),
        policy_version: a.policy.version,
        effective_events: a.events.effective,
        discarded_events: a.events.discarded,
        uncertain: a.events.uncertain,
        recommendation: a.decision.recommendation?.option.option_id ?? null,
        blockers: a.decision.blockers,
      },
    });
    a.human_case = { case_id: hc.case_id, queue: hc.queue, sla_minutes: hc.sla_minutes };
  }

  // A2/A4: se notifica solo cuando hay algo cierto que decir y nada bloquea la comunicación.
  if (a.relevant && !a.handoff.blocks_communication) {
    const msg = buildPassengerMessage(a);
    const res = await tools.notifyPassenger(msg);
    a.notification = res.status === 202 ? { notification_id: res.notification_id, state: res.state } : { rejected: res.detail };
  }

  return a;
}
