// A1 — Qué cuenta como modificación relevante.
// Un cambio es relevante cuando altera lo que el pasajero debe hacer o lo que le corresponde:
// una conexión perdida, un segmento cancelado o (vía política) un derecho nuevo.
// Un cambio de puerta o un retraso chico es un dato para mencionar, no un motivo de alerta.

import type { OperationalEvent, Segment, TripForDecision } from './types.ts';

export type ImpactConfig = {
  /** SUPUESTO: minutos mínimos entre llegada estimada y salida siguiente para mantener la conexión. Validar con Operaciones. */
  minConnectionMinutes: number;
};

export const DEFAULT_IMPACT_CONFIG: ImpactConfig = { minConnectionMinutes: 60 };

export type SegmentStatus = {
  segment_id: string;
  flight_number: string;
  origin: string;
  destination: string;
  status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' | 'UNKNOWN';
  delay_minutes: number;
  scheduled_departure: string; // "YYYY-MM-DDTHH:MM", hora local sin zona
  scheduled_arrival: string;
  estimated_departure: string;
  estimated_arrival: string;
  gate?: string;
  evidence: string[]; // ids de los eventos usados
};

export type Impact =
  | { type: 'MISSED_CONNECTION'; from_segment: string; to_segment: string; estimated_arrival: string; next_departure: string; margin_minutes: number }
  | { type: 'CONNECTION_AT_RISK'; from_segment: string; to_segment: string; estimated_arrival: string; next_departure: string; margin_minutes: number; min_required: number }
  | { type: 'SEGMENT_CANCELLED'; segment_id: string };

const MIN = 60_000;

function ts(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`); // horas tratadas como reloj local; los contratos no traen zona horaria
}

function fmt(t: number): string {
  return new Date(t).toISOString().slice(0, 16);
}

function scheduledTimes(s: Segment): { dep: number; arr: number } {
  const dep = ts(s.date, s.scheduled_departure);
  let arr = ts(s.date, s.scheduled_arrival);
  if (arr < dep) arr += 24 * 60 * MIN; // vuelo nocturno que cruza la medianoche
  return { dep, arr };
}

export function segmentStatuses(trip: TripForDecision, effective: OperationalEvent[], unknownIfNoEvents = false): SegmentStatus[] {
  return trip.segments.map((s) => {
    const evs = effective.filter((e) => e.segment_id === s.segment_id);
    const { dep, arr } = scheduledTimes(s);
    const cancelled = evs.some((e) => e.type === 'CANCELLATION' || (e.type === 'STATUS' && e.status === 'CANCELLED'));
    const delay = Math.max(0, ...evs.filter((e) => e.type === 'DELAY').map((e) => e.delay_minutes ?? 0));
    const gate = evs.find((e) => e.type === 'GATE_CHANGE')?.gate;
    const status: SegmentStatus['status'] = cancelled ? 'CANCELLED' : delay > 0 ? 'DELAYED' : evs.length === 0 && unknownIfNoEvents ? 'UNKNOWN' : 'ON_TIME';
    return {
      segment_id: s.segment_id,
      flight_number: s.flight_number,
      origin: s.origin,
      destination: s.destination,
      status,
      delay_minutes: delay,
      scheduled_departure: fmt(dep),
      scheduled_arrival: fmt(arr),
      estimated_departure: fmt(dep + delay * MIN),
      estimated_arrival: fmt(arr + delay * MIN),
      ...(gate ? { gate } : {}),
      evidence: evs.map((e) => e.event_id),
    };
  });
}

export function detectImpacts(trip: TripForDecision, effective: OperationalEvent[], cfg: ImpactConfig = DEFAULT_IMPACT_CONFIG): { segments: SegmentStatus[]; impacts: Impact[] } {
  const segments = segmentStatuses(trip, effective);
  const impacts: Impact[] = [];

  for (const s of segments) if (s.status === 'CANCELLED') impacts.push({ type: 'SEGMENT_CANCELLED', segment_id: s.segment_id });

  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    if (a.destination !== b.origin) continue; // no es una conexión
    if (a.status === 'CANCELLED' || b.status === 'CANCELLED') continue; // ya cubierto arriba
    const arrive = Date.parse(`${a.estimated_arrival}:00Z`);
    const depart = Date.parse(`${b.estimated_departure}:00Z`);
    const margin = Math.round((depart - arrive) / MIN);
    const base = { from_segment: a.segment_id, to_segment: b.segment_id, estimated_arrival: a.estimated_arrival, next_departure: b.estimated_departure, margin_minutes: margin };
    if (margin < 0) impacts.push({ type: 'MISSED_CONNECTION', ...base });
    else if (margin < cfg.minConnectionMinutes && a.delay_minutes > 0) impacts.push({ type: 'CONNECTION_AT_RISK', ...base, min_required: cfg.minConnectionMinutes });
  }

  return { segments, impacts };
}
