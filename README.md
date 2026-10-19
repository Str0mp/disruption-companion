# Disruption Companion — vertical slice Backend

Servicio que, dada una reserva, combina el contexto del viaje, los eventos operacionales y las reglas de política para determinar qué le ocurrió al pasajero, qué le corresponde y cuál es su siguiente paso, sin comunicar información no verificada y sin ejecutar acciones de alto impacto sin control.

Entregables:

- **Entregable 1, evidencia técnica:** este archivo y el código.
- **Entregable 2, README de ingeniería:** [`README-ingenieria.md`](README-ingenieria.md).
- **Entregable 3, AI Usage & Decision Note:** [`AI_NOTE.md`](AI_NOTE.md).
- Capa complementaria (experiencia del pasajero): [`docs/mensaje-al-pasajero.md`](docs/mensaje-al-pasajero.md).
- Diseño de la consulta ambigua o compleja (tarea 2, dónde entra la IA): [`docs/consulta-compleja.md`](docs/consulta-compleja.md).
- Registro de tiempo: [`TIME_LOG.md`](TIME_LOG.md). Registro bruto de uso de IA: [`AI_LOG.md`](AI_LOG.md).

## Track elegido y por qué

**Backend/Integración.** La parte difícil del caso está en combinar tres fuentes imperfectas (reserva parcial, eventos contradictorios, opciones candidatas) y decidir cuándo el sistema puede actuar solo. Eso se verifica con tests; una pantalla no. La capa de experiencia queda especificada como contrato y wireframe.

## Cómo ejecutarlo

Requiere Node 24 o superior, que ejecuta TypeScript sin paso de build. Cero dependencias en runtime.

```bash
npm install          # solo typescript y @types/node, para el typecheck
npm test             # 28 tests con el runner nativo de Node
npm run typecheck
npm start            # API en http://localhost:3000
```

```bash
# caso base del enunciado: qué ve el pasajero
curl -s -X POST localhost:3000/bookings/ABC123/assessment | jq .passenger_view

# evidencia completa para auditoría y para el agente humano
curl -s -X POST localhost:3000/bookings/ABC123/assessment | jq .assessment

# el pasajero pidió compensación en efectivo (activa R4)
curl -s -X POST localhost:3000/bookings/ABC123/assessment \
  -H 'content-type: application/json' -d '{"compensation_requested":true}' | jq .assessment.handoff

# solicitar el cambio recomendado (queda pendiente de confirmación del pasajero)
curl -s -X POST localhost:3000/bookings/ABC123/rebooking \
  -H 'content-type: application/json' \
  -d '{"option_id":"O1","idempotency_key":"abc123-o1-solicitud-1"}'
# misma clave otra vez → el 409 del proveedor se trata como éxito previo
# option_id O2 → 422, la opción no pasó los chequeos
# clave terminada en "-timeout" → simula el 503 indeterminado: caso humano, sin reintento
```

La API está desplegada en Cloudflare Workers: **https://disruption-companion.disruption-companion.workers.dev** (los mismos curl funcionan cambiando `localhost:3000` por esa URL). También hay `Dockerfile` y `render.yaml` para desplegarla en cualquier otro lado.

## Endpoints

| Método y ruta | Qué hace |
|---|---|
| `POST /bookings/:id/assessment` | Evalúa la reserva. Devuelve `passenger_view` (lo único que vería el pasajero) y `assessment` (evidencia completa). Abre caso humano y notifica si corresponde. Cuerpo opcional: `compensation_requested`, `now`. |
| `POST /bookings/:id/rebooking` | Solicita el cambio. Vuelve a evaluar antes de escribir; rechaza opciones no elegibles. Cuerpo: `option_id`, `idempotency_key`. Respuestas 201, 200 (ya solicitado), 202 (indeterminado), 422, 400. |
| `GET /health` | Salud del servicio. |
| `GET /_debug/mock` | Estado de las tools de escritura en memoria. Solo demo. |

El reloj por defecto es el de los datos de ejemplo (`2026-09-15T11:02:37Z`) para que las opciones no aparezcan expiradas; se puede pasar `now` en el cuerpo.

## Estructura

```
src/domain/events.ts        A5  fuentes contradictorias
src/domain/impacts.ts       A1  qué es una modificación relevante
src/domain/policy.ts            evaluación de reglas versionadas
src/domain/recommend.ts     A3  cuándo la recomendación es automática
src/domain/handoff.ts       A4  cuándo interviene una persona
src/domain/passengerView.ts A2  qué ve el pasajero
src/domain/pii.ts               el motor no recibe datos personales
src/domain/assess.ts            orquestador (puro) + efectos
src/tools/contracts.ts          interfaces de las 7 tools
src/tools/fixtures.ts           datos del enunciado
src/tools/mocks.ts              implementación en memoria
src/http/app.ts                 superficie HTTP (Request → Response, sin framework)
src/http/server.ts              adaptador Node
src/http/worker.ts              adaptador Cloudflare Workers
test/                           28 tests, uno o más por decisión
```

## Alcance efectivamente implementado

Evaluación completa del caso base; resolución de fuentes contradictorias; detección de conexión perdida o en riesgo; evaluación de la política con condiciones formales; los seis chequeos de automatización; derivación a humano con evidencia; mensaje al pasajero sin datos internos ni personales; solicitud de cambio con idempotencia y manejo de las tres respuestas del proveedor; notificación solo con `policy_ref`. Mocks en memoria de las siete tools con los datos del enunciado.

## Tests y validaciones

28 tests con `node:test`, sin librerías. Cubren: el caso base (R3 y no R1, O1 y no O2, caso humano por R5 en paralelo), un vuelo directo con 20 min de retraso (no relevante, nada escrito), un retraso de 4 h (voucher por R2), fuente degradada con dato más nuevo, fuentes confiables en conflicto, opciones expiradas, compensación solicitada, respuestas 201/409/503 del proveedor, validación de entrada, y dos tests que fallan si un dato personal o interno aparece donde no debe.

## Limitaciones conocidas

- Solo escenario DELAY; cancelaciones y compensaciones quedan fuera.
- Mocks en memoria: no hay persistencia, autenticación ni multi-reserva.
- Horarios sin zona horaria, como vienen en los contratos.
- El ranking de fuentes y el tiempo mínimo de conexión son supuestos documentados.
- La vista del pasajero usa plantillas fijas en español.
