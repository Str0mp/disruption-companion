// Tipos del dominio. Las formas siguen las respuestas de las tools del enunciado.

export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';

/** Pasajero completo tal como lo devuelve get_trip_context. Contiene datos personales. */
export type Passenger = {
  passenger_id: string;
  name: string;
  type: PassengerType;
  age?: number;
  email?: string;
  phone?: string;
  document_id?: string;
  loyalty_tier?: string;
};

/** Pasajero tal como lo ve el motor de decisión: sin datos personales (A2, mínimo privilegio). */
export type PassengerForDecision = {
  passenger_id: string;
  type: PassengerType;
  age?: number;
};

export type Segment = {
  segment_id: string;
  flight_number: string;
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  scheduled_departure: string; // HH:MM
  scheduled_arrival: string; // HH:MM
};

export type FareConditions = {
  changeable: boolean;
  refundable: boolean;
  fare_family: string;
  change_penalty_amount?: number;
};

export type TripMeta = {
  retrieved_at: string;
  completeness: 'COMPLETE' | 'PARTIAL';
  missing_fields: string[];
};

export type TripContext = {
  booking_id: string;
  passengers: Passenger[];
  segments: Segment[];
  fare_conditions: FareConditions;
  _meta: TripMeta;
};

export type TripForDecision = Omit<TripContext, 'passengers'> & { passengers: PassengerForDecision[] };

export type EventType = 'DELAY' | 'GATE_CHANGE' | 'STATUS' | 'CANCELLATION';

export type OperationalEvent = {
  event_id: string;
  segment_id: string;
  type: EventType;
  new_departure?: string;
  delay_minutes?: number;
  gate?: string;
  status?: string;
  source: string;
  recorded_at: string;
};

export type EventsResponse = {
  events: OperationalEvent[];
  _meta: { retrieved_at: string; sources_available: string[]; sources_degraded: string[] };
};

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type Option = {
  option_id: string;
  type: 'REBOOK' | 'REFUND';
  flight_number?: string;
  origin?: string;
  destination?: string;
  date?: string;
  departure?: string;
  fare_difference?: number;
  currency?: string;
  seats_available?: number;
  policy_ref: string;
  confidence: Confidence;
};

export type OptionsResponse = {
  options: Option[];
  _meta: { retrieved_at: string; ttl_seconds: number };
};

export type Entitlement =
  | 'REBOOK_NO_FEE'
  | 'MEAL_VOUCHER'
  | 'CASH_COMPENSATION'
  | 'PRIORITY_HANDLING';

export type PolicyRule = {
  rule_id: string;
  condition: string; // p. ej. "delay_minutes >= 240 AND international"
  entitlement: Entitlement;
  requires_human_approval: boolean;
};

export type PolicyRules = {
  scenario: string;
  version: string;
  effective_from: string;
  rules: PolicyRule[];
  _meta: { retrieved_at: string; superseded_versions: string[] };
};
