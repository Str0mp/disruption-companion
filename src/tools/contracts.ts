// Contratos de las siete tools nombradas en el enunciado.
// Los mocks y cualquier adaptador real futuro deben respetar estas formas.

import type { EventsResponse, Option, OptionsResponse, PolicyRules, TripContext } from '../domain/types.ts';

export type RebookingResult =
  | { status: 201; request_id: string; state: 'PENDING_CONFIRMATION'; expires_at: string }
  | { status: 409; error: 'DUPLICATE_REQUEST'; request_id: string }
  | { status: 503; error: 'UPSTREAM_TIMEOUT' }; // el resultado real es indeterminado

export type HumanCaseResult = { status: 201; case_id: string; queue: string; sla_minutes: number };

export type NotifyResult =
  | { status: 202; notification_id: string; channel: string; state: 'QUEUED' }
  | { status: 422; error: 'UNVALIDATED_CONTENT'; detail: string };

export type PassengerMessage = {
  booking_id: string;
  policy_ref: string; // exigido por notify_passenger: sin policy_ref no hay envío
  text: string;
};

export type HumanCaseRequest = {
  reason: string;
  evidence: Record<string, unknown>;
};

/** Tools de lectura: sin efectos. */
export interface ReadTools {
  getTripContext(bookingId: string): Promise<TripContext | null>;
  getOperationalEvents(segmentIds: string[]): Promise<EventsResponse>;
  getEligibleOptions(trip: TripContext): Promise<OptionsResponse>;
  getPolicyRules(scenario: string): Promise<PolicyRules>;
}

/** Tools de escritura: alto impacto. Separadas para que el motor de decisión pueda recibir solo lectura. */
export interface WriteTools {
  createRebookingRequest(option: Option, idempotencyKey: string): Promise<RebookingResult>;
  createHumanCase(req: HumanCaseRequest): Promise<HumanCaseResult>;
  notifyPassenger(message: PassengerMessage): Promise<NotifyResult>;
}

export type Tools = ReadTools & WriteTools;
