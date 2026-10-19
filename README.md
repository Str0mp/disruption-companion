# Disruption Companion — vertical slice Backend

Servicio que, dada una reserva, combina el contexto del viaje, los eventos operacionales y las reglas de política para determinar qué le ocurrió al pasajero, qué le corresponde y cuál es su siguiente paso, sin comunicar información no verificada y sin ejecutar acciones de alto impacto sin control.

**Track elegido: Backend/Integración.** La parte difícil del caso está en combinar tres fuentes imperfectas y decidir cuándo el sistema puede actuar solo. Eso se verifica con tests; una pantalla no. La capa de experiencia queda especificada en [`docs/mensaje-al-pasajero.md`](docs/mensaje-al-pasajero.md).

## Cómo ejecutarlo

Requiere Node 24 o superior (ejecuta TypeScript sin paso de build). Sin dependencias en runtime.

```bash
npm install          # solo typescript y @types/node, para el typecheck
npm test             # 28 tests con el runner nativo de Node
npm start            # API en http://localhost:3000
```

```bash
# caso base del enunciado
curl -s -X POST localhost:3000/bookings/ABC123/assessment | jq .passenger_view

# el pasajero solicita el cambio recomendado (queda pendiente de su confirmación)
curl -s -X POST localhost:3000/bookings/ABC123/rebooking \
  -H 'content-type: application/json' \
  -d '{"option_id":"O1","idempotency_key":"abc123-o1-solicitud-1"}'

# misma clave → 409 del proveedor, que se trata como éxito previo
# clave terminada en "-timeout" → simula el 503 indeterminado: caso humano, sin reintento
```

La respuesta de `assessment` trae dos vistas: `passenger_view`, lo único que vería el pasajero, y `assessment`, la evidencia completa para auditoría y para el agente humano.

## Problema entendido y outcome esperado

Un pasajero cuyo vuelo cambió necesita saber tres cosas: qué pasó, qué le corresponde y qué hacer ahora. El negocio quiere reducir su incertidumbre y las llamadas evitables al call center, sin equivocarse, porque una recomendación incorrecta cuesta dinero, reclamos o incumplimiento de política.

El outcome medible de una primera versión: porcentaje de disrupciones resueltas sin contacto humano, tasa de aceptación de la recomendación, y casos escalados que terminaron en la misma decisión que el sistema habría tomado (la señal para relajar los controles con evidencia).

## Supuestos y alcance

| Supuesto | Por qué | A quién lo validaría |
|---|---|---|
| Tiempo mínimo de conexión: 60 min, configurable | El caso no lo trae y sin él no se puede decidir si una conexión se pierde | Operaciones |
| Ranking de autoridad de fuentes: OPS_CORE > AIRPORT_FEED > LEGACY_MIRROR | Inferido de los nombres; un espejo copia, no origina | Operaciones / plataforma de datos |
| Solo se modela el escenario DELAY | Es el único con política en el enunciado | PM |
| "Confianza" de las opciones se usa como filtro sin conocer cómo se calcula | Es lo que el sistema de opciones expone | Dueño de `get_eligible_options` |
| Plazo: el PDF decía 48 h y sin deploy; el correo del proceso, 4 días hábiles con repo público y API desplegada | Se consultó; la respuesta fue avanzar y desplegar. Se siguió el correo | Reclutamiento |

Alcance implementado: evaluación completa del caso base, los seis chequeos de automatización, derivación a humano, mensaje al pasajero, solicitud de cambio con idempotencia y manejo de las tres respuestas del proveedor. Mocks en memoria de las siete tools con los datos del enunciado. Fuera de alcance: cancelaciones, compensaciones, múltiples reservas, persistencia, autenticación.

## Decisiones principales y alternativas descartadas

Las cinco ambigüedades del enunciado se resolvieron una por una. Cada una es un módulo con sus tests.

**1. Modificación relevante = la que cambia lo que el pasajero debe hacer o lo que le corresponde** (`impacts.ts`). Conexión perdida, cancelación o un derecho nuevo según la política. Descartado "por tipo de evento" (avisaría por un retraso de 20 min) y "por umbral de minutos" (el caso base tiene 160 min, bajo el umbral de 180 de R1, y aun así pierde la conexión: la consecuencia importa, no el tamaño).

**2. Al pasajero se le muestra solo lo necesario para entender y actuar** (`passengerView.ts`). Sin fuentes, niveles de confianza, ids de reglas ni campos faltantes; eso queda para auditoría y el agente. El motor de decisión no recibe RUT, correo ni teléfono. Descartado "mostrar todo lo no personal": "confianza media" no es accionable y genera llamadas. El riesgo real no es ocultar demasiado sino que cada frase mostrada es un compromiso, por eso solo sale validada.

**3. Recomendación automática solo si pasan seis chequeos** (`recommend.ts`): fuentes sin conflicto, datos faltantes irrelevantes para esta decisión, regla sin aprobación humana, confianza alta, viable para todo el grupo (asientos y costo), no expirada. Si falla uno, se informa lo cierto y se deriva. Descartado "siempre automático" (habría ofrecido O2: un asiento para dos pasajeros) y "nunca automático" (45 min de espera para algo que el sistema ya sabe).

**4. El pasajero confirma el cambio; un agente interviene antes de actuar cuando la política lo exige, el hecho es incierto o una escritura quedó indeterminada** (`handoff.ts`). Regla general: si lo que requiere aprobación es adicional a lo ya cierto, se informa lo cierto y se escala el resto (R5, menor en el grupo, corre en paralelo); si lo que requiere aprobación es el derecho mismo (R4, compensación), se espera. Descartado "bloquear todo si hay un menor": castiga al grupo que la regla protege. Descartado "reintentar ante 503": puede duplicar; una persona verifica.

**5. Fuentes contradictorias: descartar degradadas, luego ranking de fuente, frescura solo como desempate dentro de una fuente, y si fuentes confiables siguen discrepando en qué pasó, el hecho es incierto y decide una persona** (`events.ts`). Descartado "solo frescura": un dato nuevo de una fuente degradada ganaría. Descartado "solo ranking": nunca admite incertidumbre.

**Sin IA en runtime.** Toda la lógica es determinística. El beneficio esperado de un modelo estaría en interpretar consultas en lenguaje libre y redactar mensajes más naturales; no justifica en v1 el costo por interacción, la latencia ni un modo de fallo que no se puede auditar en un dominio donde cada frase es un compromiso. Si se incorpora después, entra en la redacción sobre plantillas aprobadas, validado contra `policy_ref` antes de enviar, nunca en la decisión.

## Clasificación de pasos

| Paso | Clasificación | Razón | Riesgo | Control / fallback |
|---|---|---|---|---|
| Resolver fuentes contradictorias | Determinístico | Reglas auditables sobre metadatos que las fuentes ya exponen | Ranking supuesto | Configurable; si fuentes confiables discrepan → humano |
| Detectar impacto (conexión perdida) | Determinístico | Aritmética de horarios | Margen de conexión supuesto | Parámetro; "en riesgo" en vez de "perdida" cerca del margen |
| Evaluar política | Determinístico | Reglas versionadas con condiciones formales | Variable desconocida | Regla INDETERMINABLE, no falsa; se reporta |
| Elegir opción y decidir si es automática | Determinístico | Seis chequeos explícitos | Demasiados casos a humano | Medir tasa de automatización y relajar con evidencia |
| Redactar el mensaje | Determinístico (plantillas) | Cada frase es un compromiso | Texto rígido | Candidato a AI-assisted sobre plantilla, validado con `policy_ref` |
| Cambiar la reserva | Human-controlled (el pasajero confirma) | Acción de alto impacto; la tool ya lo modela así | 503 indeterminado | Idempotencia; sin reintento ciego; caso humano |
| Atención prioritaria, compensación | Human-controlled (agente) | La política lo exige | Demora para el pasajero | Lo cierto se informa en paralelo |
| Consulta en lenguaje libre | AI-assisted (futuro) | Único paso donde un modelo aporta | Interpretación errónea | Fuera de v1; siempre desemboca en esta misma evaluación |

## Riesgos y próximos pasos

- **Ranking de fuentes y margen de conexión son supuestos.** Primeras dos preguntas a Operaciones.
- **Arranque conservador.** Muchos casos caerán a humano; hay que medir cuántos habrían sido iguales en automático.
- **Opciones con TTL de 120 s.** La recomendación caduca; el endpoint de cambio vuelve a evaluar antes de escribir.
- Próximos pasos: adaptadores reales detrás de las interfaces de `tools/contracts.ts`, persistencia de evaluaciones para auditoría, escenario de cancelación, autenticación del pasajero, y la capa de experiencia especificada en `docs/`.

## Cómo se validó

Typecheck estricto y 28 tests que codifican las decisiones anteriores con casos concretos: el caso base del enunciado (R3 y no R1, O1 y no O2, caso humano por R5 en paralelo), un vuelo directo con 20 min de retraso (no relevante, nada escrito), un retraso de 4 h (voucher por R2), fuente degradada con dato más nuevo, fuentes confiables en conflicto, opciones expiradas, compensación solicitada, 201/409/503 del proveedor, y dos tests que fallan si algún dato personal o interno aparece donde no debe.

## Sobre el tiempo

El registro está en [`TIME_LOG.md`](TIME_LOG.md): alrededor de 2,5 horas efectivas repartidas en una jornada, incluyendo análisis, decisiones, implementación, validación y documentación.
