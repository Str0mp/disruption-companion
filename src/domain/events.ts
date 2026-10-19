// A5 — Fuentes contradictorias.
// 1. Se descartan los eventos de fuentes marcadas como degradadas (quedan en la evidencia con su razón).
// 2. Dentro de una misma fuente, el evento más nuevo de un tipo reemplaza a los anteriores.
// 3. Si fuentes confiables discrepan en QUÉ pasó con un segmento (cancelado vs atrasado vs a tiempo),
//    el hecho es INCIERTO: esos eventos se apartan y decide una persona.
// 4. Si coinciden en qué pasó pero difieren en el detalle, gana la fuente de mayor rango.

import type { EventsResponse, OperationalEvent } from './types.ts';

/** SUPUESTO: ranking de autoridad inferido de los nombres de las fuentes. Validar con Operaciones. */
export const DEFAULT_SOURCE_RANK: readonly string[] = ['OPS_CORE', 'AIRPORT_FEED', 'LEGACY_MIRROR'];

export type DiscardReason = 'SOURCE_DEGRADED' | 'SUPERSEDED_BY_NEWER' | 'CONFLICTING_SOURCES' | 'LOWER_RANK_SOURCE';

export type DiscardedEvent = { event_id: string; source: string; segment_id: string; type: string; reason: DiscardReason; detail: string };

export type DisruptionClaim = 'CANCELLED' | 'DELAYED' | 'ON_TIME';

export type UncertainFact = { segment_id: string; claims: Array<{ source: string; claim: DisruptionClaim; event_id: string }> };

export type ResolvedEvents = {
  effective: OperationalEvent[];
  discarded: DiscardedEvent[];
  uncertain: UncertainFact[];
};

/** Qué afirma un evento sobre el segmento, para detectar conflictos entre fuentes confiables. */
export function disruptionClaim(e: OperationalEvent): DisruptionClaim | null {
  if (e.type === 'CANCELLATION') return 'CANCELLED';
  if (e.type === 'DELAY') return (e.delay_minutes ?? 0) > 0 ? 'DELAYED' : 'ON_TIME';
  if (e.type === 'STATUS') {
    const s = (e.status ?? '').toUpperCase();
    if (s === 'CANCELLED') return 'CANCELLED';
    if (s === 'DELAYED') return 'DELAYED';
    if (s === 'ON_TIME' || s === 'SCHEDULED') return 'ON_TIME';
  }
  return null;
}

function rankOf(source: string, rank: readonly string[]): number {
  const i = rank.indexOf(source);
  return i === -1 ? rank.length : i; // una fuente desconocida queda última, no se descarta
}

function discard(e: OperationalEvent, reason: DiscardReason, detail: string): DiscardedEvent {
  return { event_id: e.event_id, source: e.source, segment_id: e.segment_id, type: e.type, reason, detail };
}

export function resolveEvents(res: EventsResponse, rank: readonly string[] = DEFAULT_SOURCE_RANK): ResolvedEvents {
  const degraded = new Set(res._meta.sources_degraded);
  const discarded: DiscardedEvent[] = [];
  const uncertain: UncertainFact[] = [];

  // 1. fuera las fuentes degradadas
  const reliable = res.events.filter((e) => {
    if (degraded.has(e.source)) { discarded.push(discard(e, 'SOURCE_DEGRADED', `la fuente ${e.source} está marcada como degradada por el proveedor de eventos`)); return false; }
    return true;
  });

  // 2. el más nuevo por (segmento, tipo, fuente)
  const latest = new Map<string, OperationalEvent>();
  for (const e of reliable) {
    const key = `${e.segment_id}|${e.type}|${e.source}`;
    const prev = latest.get(key);
    if (!prev) { latest.set(key, e); continue; }
    if (e.recorded_at > prev.recorded_at) { discarded.push(discard(prev, 'SUPERSEDED_BY_NEWER', `hay un evento más nuevo (${e.event_id}) de la misma fuente`)); latest.set(key, e); }
    else discarded.push(discard(e, 'SUPERSEDED_BY_NEWER', `hay un evento más nuevo (${prev.event_id}) de la misma fuente`));
  }
  const current = [...latest.values()];

  // 3. afirmaciones en conflicto entre fuentes confiables → segmento incierto
  const bySegment = new Map<string, OperationalEvent[]>();
  for (const e of current) bySegment.set(e.segment_id, [...(bySegment.get(e.segment_id) ?? []), e]);

  const conflicting = new Set<string>();
  for (const [segment_id, evs] of bySegment) {
    const claimBySource = new Map<string, { claim: DisruptionClaim; event_id: string }>();
    for (const e of evs) {
      const c = disruptionClaim(e);
      if (!c) continue;
      const prev = claimBySource.get(e.source);
      // dentro de una fuente gana la afirmación más fuerte (CANCELLED > DELAYED > ON_TIME)
      const strength: Record<DisruptionClaim, number> = { CANCELLED: 3, DELAYED: 2, ON_TIME: 1 };
      if (!prev || strength[c] > strength[prev.claim]) claimBySource.set(e.source, { claim: c, event_id: e.event_id });
    }
    const distinct = new Set([...claimBySource.values()].map((v) => v.claim));
    if (distinct.size > 1) {
      conflicting.add(segment_id);
      uncertain.push({ segment_id, claims: [...claimBySource.entries()].map(([source, v]) => ({ source, ...v })) });
    }
  }

  // 4. por (segmento, tipo) gana la fuente de mayor rango
  const effective: OperationalEvent[] = [];
  const byKind = new Map<string, OperationalEvent[]>();
  for (const e of current) {
    if (conflicting.has(e.segment_id) && disruptionClaim(e) !== null) {
      discarded.push(discard(e, 'CONFLICTING_SOURCES', `fuentes confiables discrepan sobre qué pasó con ${e.segment_id}`));
      continue;
    }
    const key = `${e.segment_id}|${e.type}`;
    byKind.set(key, [...(byKind.get(key) ?? []), e]);
  }
  for (const evs of byKind.values()) {
    const sorted = [...evs].sort((a, b) => rankOf(a.source, rank) - rankOf(b.source, rank) || b.recorded_at.localeCompare(a.recorded_at));
    const [winner, ...losers] = sorted;
    if (winner) effective.push(winner);
    for (const l of losers) discarded.push(discard(l, 'LOWER_RANK_SOURCE', `${winner!.source} tiene mayor rango que ${l.source}`));
  }

  effective.sort((a, b) => a.segment_id.localeCompare(b.segment_id) || a.recorded_at.localeCompare(b.recorded_at));
  return { effective, discarded, uncertain };
}
