# README de ingeniería

## Problema entendido y outcome esperado

Un pasajero cuyo vuelo cambió necesita saber tres cosas: qué pasó, qué le corresponde y qué hacer ahora. El negocio quiere reducir su incertidumbre y las llamadas evitables al call center sin equivocarse, porque una recomendación incorrecta cuesta dinero, reclamos o incumplimiento de política.

Outcome medible de una primera versión: porcentaje de disrupciones resueltas sin contacto humano, tasa de aceptación de la recomendación, y casos escalados que terminaron en la misma decisión que el sistema habría tomado, que es la señal para relajar controles con evidencia.

## Supuestos y alcance

| Supuesto | Por qué | A quién lo validaría |
|---|---|---|
| Tiempo mínimo de conexión: 60 min, configurable | El caso no lo trae y sin él no se decide si una conexión se pierde | Operaciones |
| Ranking de fuentes: OPS_CORE > AIRPORT_FEED > LEGACY_MIRROR | Inferido de los nombres; un espejo copia, no origina | Operaciones / plataforma de datos |
| Solo escenario DELAY | Es el único con política en el enunciado | PM |
| "Confianza" de las opciones como filtro, sin saber cómo se calcula | Es lo que el sistema de opciones expone | Dueño de `get_eligible_options` |
| Plazo y deploy según el correo del proceso (4 días hábiles, API pública), no según el PDF (48 h, sin deploy) | Se consultó; la respuesta fue avanzar y desplegar | Reclutamiento |

Alcance: evaluación del caso base, automatización controlada, derivación, mensaje al pasajero, solicitud de cambio idempotente. Fuera: cancelaciones, compensaciones, persistencia, autenticación.

## Decisiones principales y alternativas descartadas

Las cinco ambigüedades del enunciado se resolvieron una por una; cada una es un módulo con sus tests.

**1. Modificación relevante = la que cambia lo que el pasajero debe hacer o lo que le corresponde** (`impacts.ts`): conexión perdida, cancelación o un derecho nuevo. Descartado "por tipo de evento" (avisaría por 20 min de retraso) y "por umbral" (el caso base tiene 160 min, bajo los 180 de R1, y aun así pierde la conexión: importa la consecuencia, no el tamaño).

**2. Al pasajero, solo lo necesario para entender y actuar** (`passengerView.ts`). Sin fuentes, confianza, ids de reglas ni campos faltantes; eso es para auditoría y el agente. El motor no recibe RUT, correo ni teléfono. Descartado "mostrar todo lo no personal": "confianza media" no es accionable y genera llamadas. El riesgo real no es ocultar demasiado, es que cada frase mostrada es un compromiso; por eso solo sale validada.

**3. Recomendación automática solo si pasan seis chequeos** (`recommend.ts`): fuentes sin conflicto, datos faltantes irrelevantes para esta decisión, regla sin aprobación humana, confianza alta, viable para todo el grupo, no expirada. Si falla uno, se informa lo cierto y se deriva. Descartado "siempre automático" (habría ofrecido O2: un asiento para dos pasajeros) y "nunca automático" (45 min de espera para algo que el sistema ya sabe).

**4. El pasajero confirma el cambio; un agente interviene antes de actuar cuando la política lo exige, el hecho es incierto o una escritura quedó indeterminada** (`handoff.ts`). Si lo que requiere aprobación es adicional a lo ya cierto, se informa lo cierto y se escala el resto (R5, menor en el grupo, corre en paralelo); si es el derecho mismo (R4, compensación), se espera. Descartado "bloquear todo si hay un menor": castiga al grupo que la regla protege. Descartado "reintentar ante 503": puede duplicar; una persona verifica.

**5. Fuentes contradictorias: fuera las degradadas, luego ranking de fuente, frescura solo como desempate dentro de una fuente; si fuentes confiables siguen discrepando en qué pasó, el hecho es incierto y decide una persona** (`events.ts`). Descartado "solo frescura": ganaría un dato nuevo de una fuente degradada. Descartado "solo ranking": nunca admite incertidumbre.

**IA: dónde sí y dónde no.** Sin IA en runtime en v1: el beneficio esperado (interpretar consultas en lenguaje libre, redactar mensajes más naturales) no justifica el costo por interacción, la latencia ni un modo de fallo no auditable donde cada frase es un compromiso. El diseño de la consulta ambigua está en [`docs/consulta-compleja.md`](docs/consulta-compleja.md): un modelo con salida estructurada convierte el texto en intents de un catálogo cerrado, el motor determinístico de este slice decide, y la redacción es sobre hechos ya validados, verificando que cada afirmación trace a un campo y lleve `policy_ref`. Sin agente con herramientas: el orden de las tools es fijo y las escrituras no se delegan a un modelo.

## Clasificación de pasos

| Paso | Clasificación | Razón | Riesgo | Control / fallback |
|---|---|---|---|---|
| Resolver fuentes contradictorias | Determinístico | Reglas auditables sobre metadatos que las fuentes exponen | Ranking supuesto | Configurable; conflicto entre confiables → humano |
| Detectar impacto | Determinístico | Aritmética de horarios | Margen supuesto | Parámetro; "en riesgo" cerca del margen |
| Evaluar política | Determinístico | Reglas versionadas, condiciones formales | Variable desconocida | Regla INDETERMINABLE, no falsa |
| Elegir opción y decidir automatización | Determinístico | Seis chequeos explícitos | Demasiado a humano | Medir y relajar con evidencia |
| Redactar el mensaje | Determinístico (plantillas) | Cada frase es un compromiso | Texto rígido | Futuro AI-assisted sobre plantilla, validado |
| Cambiar la reserva | Human-controlled (pasajero) | Alto impacto; la tool ya lo modela así | 503 indeterminado | Idempotencia; sin reintento ciego; caso humano |
| Atención prioritaria, compensación | Human-controlled (agente) | La política lo exige | Demora | Lo cierto se informa en paralelo |
| Consulta en lenguaje libre | AI-assisted (futuro) | Único paso donde un modelo aporta | Mala interpretación | Fuera de v1; desemboca en esta misma evaluación |
| Orquestar las tools | Determinístico, **no agentic** | Orden fijo: reserva → eventos → política → opciones; las escrituras no se delegan a un modelo | Rigidez ante escenarios nuevos | Cada escenario entra como código con tests |

## Riesgos y próximos pasos

Ranking de fuentes y margen de conexión son supuestos: primeras preguntas a Operaciones. El arranque conservador manda muchos casos a humano: medir cuántos habrían sido iguales en automático. Las opciones caducan a los 120 s: el endpoint de cambio vuelve a evaluar antes de escribir. Próximos pasos: adaptadores reales detrás de `tools/contracts.ts`, persistencia de evaluaciones para auditoría, escenario de cancelación, autenticación, y la capa de experiencia especificada en `docs/`.

## Cómo se validó

Typecheck estricto y 28 tests que codifican las decisiones con casos concretos: el caso base, un vuelo directo con 20 min, un retraso de 4 h, fuente degradada con dato más nuevo, fuentes confiables en conflicto, opciones expiradas, compensación solicitada, 201/409/503 del proveedor, y dos tests que fallan si un dato personal o interno aparece donde no debe. Además, ejecución manual con curl sobre la API.

## Tiempo

2 h 41 min efectivos en una jornada: análisis y decisiones (1 h 20), implementación y tests (20 min), documentación, deploy y verificación (el resto). Detalle en `TIME_LOG.md`.
