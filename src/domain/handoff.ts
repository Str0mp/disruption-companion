// A4 — Cuándo debe intervenir una persona antes de actuar o comunicar.
// El pasajero confirma cualquier cambio de reserva (la tool devuelve PENDING_CONFIRMATION).
// Un agente interviene cuando la política exige aprobación, cuando el hecho mismo es incierto,
// o cuando hay impacto pero ninguna opción viable. La aprobación de algo ADICIONAL
// (p. ej. R5, atención prioritaria) no bloquea informar lo que ya es cierto.

import type { Impact } from './impacts.ts';
import type { PolicyOutcome } from './policy.ts';
import type { RecommendOutcome } from './recommend.ts';

export type HandoffReason = {
  code: 'POLICY_REQUIRES_HUMAN_APPROVAL' | 'FACT_UNCERTAIN' | 'NO_VIABLE_OPTION' | 'UNDETERMINABLE_RULE';
  detail: string;
  rule_id?: string;
};

export type Handoff = {
  required: boolean;
  /** true cuando no se puede comunicar nada cierto hasta que una persona verifique */
  blocks_communication: boolean;
  reasons: HandoffReason[];
};

export function decideHandoff(input: { relevant: boolean; impacts: Impact[]; policy: PolicyOutcome; recommend: RecommendOutcome }): Handoff {
  const { relevant, impacts, policy, recommend } = input;
  const reasons: HandoffReason[] = [];

  const factUncertain = recommend.blockers.some((b) => b.check === 'SOURCES_AGREE');
  if (factUncertain) reasons.push({ code: 'FACT_UNCERTAIN', detail: recommend.blockers.find((b) => b.check === 'SOURCES_AGREE')!.detail });

  if (relevant || factUncertain) {
    for (const r of policy.applied.filter((r) => r.requires_human_approval)) {
      reasons.push({ code: 'POLICY_REQUIRES_HUMAN_APPROVAL', rule_id: r.rule_id, detail: `${r.entitlement} requiere aprobación humana (${r.rule_id})` });
    }
    for (const r of policy.undeterminable) {
      reasons.push({ code: 'UNDETERMINABLE_RULE', rule_id: r.rule_id, detail: `no se puede evaluar ${r.rule_id}: se desconoce ${r.unknown_variables.join(', ')}` });
    }
    if (impacts.length > 0 && !recommend.recommendation && !factUncertain) {
      reasons.push({ code: 'NO_VIABLE_OPTION', detail: 'el pasajero está afectado pero ninguna opción pasó todos los chequeos' });
    }
  }

  return { required: reasons.length > 0, blocks_communication: factUncertain, reasons };
}
