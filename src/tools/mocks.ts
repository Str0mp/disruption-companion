// Implementación en memoria de las siete tools, cargada con los datos de ejemplo.
// El comportamiento sigue los ejemplos de respuesta del enunciado, incluidos los modos de falla.

import type { EventsResponse, Option, OptionsResponse, PolicyRules, TripContext } from '../domain/types.ts';
import type { HumanCaseRequest, HumanCaseResult, NotifyResult, PassengerMessage, RebookingResult, Tools } from './contracts.ts';
import { EVENTS_ABC123, OPTIONS_ABC123, POLICY_DELAY, TRIP_ABC123 } from './fixtures.ts';

export type MockSeed = {
  trips?: Record<string, TripContext>;
  events?: Record<string, EventsResponse>; // indexado por booking_id por simplicidad
  options?: Record<string, OptionsResponse>;
  policies?: Record<string, PolicyRules>;
};

/** Una clave de idempotencia que termine con este sufijo hace que la tool de cambio dé timeout (simula el 503). */
export const TIMEOUT_KEY_SUFFIX = '-timeout';

export class MockTools implements Tools {
  readonly trips: Record<string, TripContext>;
  readonly events: Record<string, EventsResponse>;
  readonly options: Record<string, OptionsResponse>;
  readonly policies: Record<string, PolicyRules>;

  readonly rebookings = new Map<string, { request_id: string; expires_at: string }>();
  readonly humanCases: Array<HumanCaseRequest & { case_id: string }> = [];
  readonly notifications: PassengerMessage[] = [];

  private seq = 0;

  constructor(seed: MockSeed = {}) {
    this.trips = seed.trips ?? { ABC123: TRIP_ABC123 };
    this.events = seed.events ?? { ABC123: EVENTS_ABC123 };
    this.options = seed.options ?? { ABC123: OPTIONS_ABC123 };
    this.policies = seed.policies ?? { DELAY: POLICY_DELAY };
  }

  async getTripContext(bookingId: string): Promise<TripContext | null> {
    return this.trips[bookingId] ?? null;
  }

  async getOperationalEvents(segmentIds: string[]): Promise<EventsResponse> {
    const all = Object.values(this.events);
    const match = all.find((r) => r.events.some((e) => segmentIds.includes(e.segment_id))) ?? all[0];
    if (!match) return { events: [], _meta: { retrieved_at: new Date().toISOString(), sources_available: [], sources_degraded: [] } };
    return { ...match, events: match.events.filter((e) => segmentIds.includes(e.segment_id)) };
  }

  async getEligibleOptions(trip: TripContext): Promise<OptionsResponse> {
    return this.options[trip.booking_id] ?? { options: [], _meta: { retrieved_at: new Date().toISOString(), ttl_seconds: 120 } };
  }

  async getPolicyRules(scenario: string): Promise<PolicyRules> {
    const p = this.policies[scenario];
    if (!p) throw new Error(`No hay política para el escenario ${scenario}`);
    return p;
  }

  async createRebookingRequest(option: Option, idempotencyKey: string): Promise<RebookingResult> {
    if (idempotencyKey.endsWith(TIMEOUT_KEY_SUFFIX)) return { status: 503, error: 'UPSTREAM_TIMEOUT' };
    const existing = this.rebookings.get(idempotencyKey);
    if (existing) return { status: 409, error: 'DUPLICATE_REQUEST', request_id: existing.request_id };
    const request_id = `RBK-${88231 + this.seq++}`;
    const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
    this.rebookings.set(idempotencyKey, { request_id, expires_at });
    void option;
    return { status: 201, request_id, state: 'PENDING_CONFIRMATION', expires_at };
  }

  async createHumanCase(req: HumanCaseRequest): Promise<HumanCaseResult> {
    const case_id = `HC-${4471 + this.humanCases.length}`;
    this.humanCases.push({ ...req, case_id });
    return { status: 201, case_id, queue: 'DISRUPTION_L2', sla_minutes: 45 };
  }

  async notifyPassenger(message: PassengerMessage): Promise<NotifyResult> {
    if (!message.policy_ref) return { status: 422, error: 'UNVALIDATED_CONTENT', detail: 'falta policy_ref' };
    this.notifications.push(message);
    return { status: 202, notification_id: `NT-${9912 + this.notifications.length}`, channel: 'PUSH', state: 'QUEUED' };
  }
}
