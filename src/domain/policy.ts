// Evaluación de la política. Las reglas son datos versionados; las condiciones usan una gramática mínima:
//   <variable> <op> <literal> [AND ...]   o una variable booleana sola.
// Una regla cuyas únicas cláusulas sin resolver usan variables desconocidas queda INDETERMINABLE, no falsa.

import type { Impact, SegmentStatus } from './impacts.ts';
import type { Entitlement, PolicyRules, TripForDecision } from './types.ts';

export type Facts = {
  delay_minutes: number;
  international?: boolean; // undefined cuando no se conoce el país de algún aeropuerto
  missed_connection: boolean;
  compensation_requested: boolean;
  group_includes_minor: boolean;
};

export type RuleEvaluation = {
  rule_id: string;
  condition: string;
  entitlement: Entitlement;
  requires_human_approval: boolean;
  outcome: 'APPLIES' | 'DOES_NOT_APPLY' | 'UNDETERMINABLE';
  unknown_variables: string[];
};

export type PolicyOutcome = {
  version: string;
  evaluations: RuleEvaluation[];
  applied: RuleEvaluation[];
  undeterminable: RuleEvaluation[];
};

/** SUPUESTO: mapa mínimo aeropuerto→país para el ejemplo; un código desconocido deja `international` indefinido. */
const AIRPORT_COUNTRY: Record<string, string> = { SCL: 'CL', LIM: 'PE', MEX: 'MX', GRU: 'BR', EZE: 'AR', BOG: 'CO', MIA: 'US', JFK: 'US', MAD: 'ES' };

export function deriveFacts(trip: TripForDecision, segments: SegmentStatus[], impacts: Impact[], compensationRequested: boolean): Facts {
  const countries = trip.segments.flatMap((s) => [AIRPORT_COUNTRY[s.origin], AIRPORT_COUNTRY[s.destination]]);
  const international = countries.some((c) => c === undefined) ? undefined : new Set(countries).size > 1;
  return {
    delay_minutes: Math.max(0, ...segments.map((s) => s.delay_minutes)),
    ...(international !== undefined ? { international } : {}),
    missed_connection: impacts.some((i) => i.type === 'MISSED_CONNECTION'),
    compensation_requested: compensationRequested,
    group_includes_minor: trip.passengers.some((p) => p.type === 'CHILD' || p.type === 'INFANT' || (p.age !== undefined && p.age < 18)),
  };
}

type Literal = number | boolean | string;

function parseLiteral(raw: string): Literal {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return Number.isNaN(n) ? raw.replace(/^['"]|['"]$/g, '') : n;
}

function compare(a: Literal, op: string, b: Literal): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>=': return Number(a) >= Number(b);
    case '<=': return Number(a) <= Number(b);
    case '>': return Number(a) > Number(b);
    case '<': return Number(a) < Number(b);
    default: throw new Error(`operador no soportado: ${op}`);
  }
}

export function evaluateCondition(condition: string, facts: Record<string, Literal | undefined>): { outcome: RuleEvaluation['outcome']; unknown: string[] } {
  const clauses = condition.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
  let anyFalse = false;
  const unknown: string[] = [];
  for (const clause of clauses) {
    const m = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(\S+)$/.exec(clause);
    const variable = m ? m[1]! : clause;
    const value = facts[variable];
    if (value === undefined) { unknown.push(variable); continue; }
    const ok = m ? compare(value, m[2]!, parseLiteral(m[3]!)) : value === true;
    if (!ok) anyFalse = true;
  }
  if (anyFalse) return { outcome: 'DOES_NOT_APPLY', unknown };
  if (unknown.length > 0) return { outcome: 'UNDETERMINABLE', unknown };
  return { outcome: 'APPLIES', unknown };
}

export function evaluatePolicy(policy: PolicyRules, facts: Facts): PolicyOutcome {
  const evaluations = policy.rules.map<RuleEvaluation>((r) => {
    const { outcome, unknown } = evaluateCondition(r.condition, facts as Record<string, Literal | undefined>);
    return { rule_id: r.rule_id, condition: r.condition, entitlement: r.entitlement, requires_human_approval: r.requires_human_approval, outcome, unknown_variables: unknown };
  });
  return {
    version: policy.version,
    evaluations,
    applied: evaluations.filter((e) => e.outcome === 'APPLIES'),
    undeterminable: evaluations.filter((e) => e.outcome === 'UNDETERMINABLE'),
  };
}
