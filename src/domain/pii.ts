// A2 / mínimo privilegio: el motor de decisión nunca ve datos personales que no necesita.

import type { TripContext, TripForDecision } from './types.ts';

export function stripPii(trip: TripContext): TripForDecision {
  return {
    ...trip,
    passengers: trip.passengers.map((p) => ({ passenger_id: p.passenger_id, type: p.type, ...(p.age !== undefined ? { age: p.age } : {}) })),
  };
}
