// Datos de ejemplo tomados tal cual del enunciado (reserva ABC123).

import type { EventsResponse, OptionsResponse, PolicyRules, TripContext } from '../domain/types.ts';

export const TRIP_ABC123: TripContext = {
  booking_id: 'ABC123',
  passengers: [
    {
      passenger_id: 'P1', name: 'María Silva', type: 'ADULT',
      email: 'maria.silva@example.com', phone: '+56 9 8765 4321',
      document_id: '12.345.678-9', loyalty_tier: 'GOLD',
    },
    { passenger_id: 'P2', name: 'Tomás Silva', type: 'CHILD', age: 7 },
  ],
  segments: [
    { segment_id: 'S1', flight_number: 'LA500', origin: 'SCL', destination: 'LIM', date: '2026-09-15', scheduled_departure: '14:30', scheduled_arrival: '17:55' },
    { segment_id: 'S2', flight_number: 'LA2410', origin: 'LIM', destination: 'MEX', date: '2026-09-15', scheduled_departure: '19:05', scheduled_arrival: '23:40' },
  ],
  fare_conditions: { changeable: true, refundable: false, fare_family: 'LIGHT' },
  _meta: { retrieved_at: '2026-09-15T11:02:31Z', completeness: 'PARTIAL', missing_fields: ['fare_conditions.change_penalty_amount'] },
};

export const EVENTS_ABC123: EventsResponse = {
  events: [
    { event_id: 'E-1001', segment_id: 'S1', type: 'DELAY', new_departure: '17:10', delay_minutes: 160, source: 'OPS_CORE', recorded_at: '2026-09-15T10:48:00Z' },
    { event_id: 'E-1007', segment_id: 'S1', type: 'GATE_CHANGE', gate: '24', source: 'AIRPORT_FEED', recorded_at: '2026-09-15T10:55:00Z' },
    { event_id: 'E-1012', segment_id: 'S1', type: 'STATUS', status: 'ON_TIME', source: 'LEGACY_MIRROR', recorded_at: '2026-09-15T09:30:00Z' },
    { event_id: 'E-2003', segment_id: 'S2', type: 'STATUS', status: 'SCHEDULED', source: 'OPS_CORE', recorded_at: '2026-09-15T10:48:00Z' },
  ],
  _meta: { retrieved_at: '2026-09-15T11:02:33Z', sources_available: ['OPS_CORE', 'AIRPORT_FEED', 'LEGACY_MIRROR'], sources_degraded: ['LEGACY_MIRROR'] },
};

export const OPTIONS_ABC123: OptionsResponse = {
  options: [
    { option_id: 'O1', type: 'REBOOK', flight_number: 'LA2412', origin: 'LIM', destination: 'MEX', date: '2026-09-16', departure: '08:15', fare_difference: 0, seats_available: 4, policy_ref: 'POL-DELAY-2026-03', confidence: 'HIGH' },
    { option_id: 'O2', type: 'REBOOK', flight_number: 'LA2450', origin: 'LIM', destination: 'MEX', date: '2026-09-15', departure: '23:40', fare_difference: 180000, currency: 'CLP', seats_available: 1, policy_ref: 'POL-DELAY-2026-03', confidence: 'MEDIUM' },
    { option_id: 'O3', type: 'REFUND', policy_ref: 'POL-REFUND-2026-01', confidence: 'LOW' },
  ],
  _meta: { retrieved_at: '2026-09-15T11:02:35Z', ttl_seconds: 120 },
};

export const POLICY_DELAY: PolicyRules = {
  scenario: 'DELAY',
  version: 'POL-DELAY-2026-03',
  effective_from: '2026-03-01',
  rules: [
    { rule_id: 'R1', condition: 'delay_minutes >= 180', entitlement: 'REBOOK_NO_FEE', requires_human_approval: false },
    { rule_id: 'R2', condition: 'delay_minutes >= 240 AND international', entitlement: 'MEAL_VOUCHER', requires_human_approval: false },
    { rule_id: 'R3', condition: 'missed_connection == true', entitlement: 'REBOOK_NO_FEE', requires_human_approval: false },
    { rule_id: 'R4', condition: 'compensation_requested == true', entitlement: 'CASH_COMPENSATION', requires_human_approval: true },
    { rule_id: 'R5', condition: 'group_includes_minor == true', entitlement: 'PRIORITY_HANDLING', requires_human_approval: true },
  ],
  _meta: { retrieved_at: '2026-09-15T11:02:36Z', superseded_versions: ['POL-DELAY-2025-11'] },
};

/** El "ahora" de los datos de ejemplo: 2 segundos después de recuperar las opciones, así siguen vigentes. */
export const SAMPLE_NOW = '2026-09-15T11:02:37Z';
