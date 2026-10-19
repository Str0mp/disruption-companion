import type { EventsResponse, OperationalEvent, OptionsResponse, TripContext } from '../src/domain/types.ts';
import { EVENTS_ABC123, OPTIONS_ABC123, TRIP_ABC123 } from '../src/tools/fixtures.ts';

export function trip(overrides: Partial<TripContext> = {}): TripContext {
  return structuredClone({ ...TRIP_ABC123, ...overrides });
}

export function events(evs: OperationalEvent[], degraded: string[] = ['LEGACY_MIRROR']): EventsResponse {
  return { events: evs, _meta: { ...EVENTS_ABC123._meta, sources_degraded: degraded } };
}

export function delay(segment_id: string, minutes: number, extra: Partial<OperationalEvent> = {}): OperationalEvent {
  return { event_id: `E-${segment_id}-${minutes}`, segment_id, type: 'DELAY', delay_minutes: minutes, source: 'OPS_CORE', recorded_at: '2026-09-15T10:48:00Z', ...extra };
}

export function options(overrides: Partial<OptionsResponse> = {}): OptionsResponse {
  return structuredClone({ ...OPTIONS_ABC123, ...overrides });
}

/** Pedro: vuelo directo SCL–LIM, un adulto. */
export const PEDRO: TripContext = {
  booking_id: 'PEDRO1',
  passengers: [{ passenger_id: 'P1', name: 'Pedro Rojas', type: 'ADULT', email: 'pedro@example.com' }],
  segments: [{ segment_id: 'S1', flight_number: 'LA500', origin: 'SCL', destination: 'LIM', date: '2026-09-15', scheduled_departure: '14:30', scheduled_arrival: '17:55' }],
  fare_conditions: { changeable: true, refundable: false, fare_family: 'LIGHT' },
  _meta: { retrieved_at: '2026-09-15T11:02:31Z', completeness: 'COMPLETE', missing_fields: [] },
};
