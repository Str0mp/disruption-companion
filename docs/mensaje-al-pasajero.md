# Capa complementaria: qué ve el pasajero

Especificación del mensaje y la pantalla que consumirían `passenger_view`. No está implementada; el backend ya produce exactamente estos campos.

## Principios (decisión A2)

1. Solo lo que necesita para entender y actuar: qué pasó, qué le corresponde, qué hacer.
2. Nada interno: fuentes, confianza, ids de reglas, campos faltantes.
3. Nada personal en el canal push: ni documento ni contacto.
4. Cada frase es un compromiso: la vista se genera solo desde una evaluación validada, y la notificación lleva `policy_ref` o el proveedor la rechaza (422).

## Tres estados

| `status` | Cuándo | Qué se muestra |
|---|---|---|
| `NO_RELEVANT_CHANGE` | Sin impacto ni derecho nuevo (p. ej. 20 min en vuelo directo) | Horarios vigentes, puerta si cambió. Sin alerta |
| `DISRUPTED` | Impacto o derecho nuevo, hecho verificado | Alerta, derecho, recomendación si la hay, siguiente paso |
| `UNDER_REVIEW` | Fuentes confiables en conflicto | "Estamos verificando". Nada más, hasta que un agente confirme |

## Contrato que consume la pantalla

```json
{
  "booking_id": "ABC123",
  "status": "DISRUPTED",
  "headline": "Por el retraso no alcanzarás tu conexión.",
  "details": ["Tu vuelo LA500 SCL–LIM saldrá a las 17:10 (antes 14:30).", "LA500 embarca por la puerta 24."],
  "entitlement": "Según nuestra política de retrasos vigente, puedes cambiar tu vuelo sin costo.",
  "recommendation": { "flight_number": "LA2412", "date": "2026-09-16", "departure": "08:15", "cost": "sin costo", "valid_until": "2026-09-15T11:04:35.000Z", "how_to_confirm": "Confirma desde la app o con un agente." },
  "next_step": "Te recomendamos el vuelo LA2412 del 2026-09-16 a las 08:15, sin costo. Confirma desde la app o con un agente. Además, un agente te contactará para asistirte.",
  "agent_follow_up": true,
  "policy_reference": "POL-DELAY-2026-03"
}
```

## Pantalla (wireframe en texto)

```
┌──────────────────────────────────────────────┐
│ ⚠ Por el retraso no alcanzarás tu conexión.  │  ← headline
├──────────────────────────────────────────────┤
│ LA500  SCL → LIM   14:30 → 17:10  Puerta 24  │  ← details
│ LA2410 LIM → MEX   19:05  (no alcanzable)    │
├──────────────────────────────────────────────┤
│ Puedes cambiar tu vuelo sin costo.           │  ← entitlement
│                                              │
│ Recomendado                                  │  ← recommendation
│ LA2412  LIM → MEX  mañana 08:15  sin costo   │
│ Válido por 01:58                             │  ← cuenta regresiva desde valid_until
│                                              │
│ [ Confirmar este vuelo ]  [ Hablar con agente ]│
├──────────────────────────────────────────────┤
│ ⓘ Un agente te contactará para asistirte.    │  ← si agent_follow_up
│ Política de retrasos POL-DELAY-2026-03       │  ← policy_reference, enlace a términos
└──────────────────────────────────────────────┘
```

## Interacciones

- **Confirmar este vuelo** → `POST /bookings/:id/rebooking` con `option_id` y una `idempotency_key` generada por el cliente y conservada entre reintentos. Respuestas: 201 "Solicitud creada, confirma antes de HH:MM"; 200 `ALREADY_REQUESTED` "Ya tienes esta solicitud"; 202 `INDETERMINATE` "No pudimos confirmar; un agente lo verificará, no vuelvas a intentar"; 422 "Esta opción ya no está disponible", y se vuelve a pedir la evaluación.
- **Expiración.** Al llegar a `valid_until` el botón se desactiva y se vuelve a pedir la evaluación.
- **Hablar con agente** siempre visible. Si `agent_follow_up` es true, se muestra el aviso de contacto.
- **Sin recomendación** (`recommendation` ausente): el bloque se reemplaza por "Estamos buscando la mejor alternativa. Un agente te contactará."

## Qué no se muestra nunca

`assessment` completo, nombres de fuentes, `confidence`, `rule_id`, `missing_fields`, `blockers`, razones de rechazo de otras opciones, documento, correo, teléfono. Todo eso lo ve el agente en su herramienta, con la misma evaluación.
