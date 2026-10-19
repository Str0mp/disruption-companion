# Consulta ambigua o compleja: dónde entra la IA y dónde se detiene

Diseño de la tarea 2 del enunciado. No está implementado; el motor determinístico que usa sí lo está (`src/domain/assess.ts`).

## El ejemplo

María escribe en la app, en lenguaje libre:

> "Hola, me avisaron que mi vuelo a Lima se atrasó. ¿Alcanzo el de México? ¿Puedo llegar hoy igual? Voy con mi hijo de 7 años y mañana tiene colegio. Y si no, ¿me devuelven la plata?"

Una sola consulta mezcla cinco cosas: estado del vuelo, conexión, alternativa el mismo día, un menor en el grupo, y reembolso. Y trae datos personales irrelevantes para la decisión (el colegio).

## Descomposición del trabajo

| Paso | Qué hace | Clasificación | Contexto que recibe | Dónde se detiene |
|---|---|---|---|---|
| 1. Entender la consulta | Convierte el texto en una consulta estructurada: `{ intents: [ESTADO, CONEXION, ALTERNATIVA_HOY, REEMBOLSO], mentions_minor: true, compensation_requested: false }` | **AI-assisted** (modelo con salida estructurada, esquema cerrado) | Solo el texto de María y el `booking_id` de la sesión. Nada de la reserva | Si el modelo no logra mapear a intents conocidos, o detecta un intent fuera de catálogo (p. ej. hotel, mascota), marca `unknown_intent` |
| 2. Recuperar contexto | Reserva, eventos de sus segmentos, política del escenario, opciones elegibles | **Determinístico** (las cuatro tools de lectura) | `booking_id` | Si `get_trip_context` no responde o devuelve incompleta en campos críticos → humano |
| 3. Decidir | El motor ya construido: fuentes (A5), impacto (A1), política, recomendación (A3), derivación (A4) | **Determinístico** | Reserva sin datos personales, eventos, política, opciones | Donde el motor ya se detiene: hecho incierto, regla con aprobación, escritura indeterminada |
| 4. Responder cada intent | Mapea cada intent a un campo de la evaluación: ESTADO → `segments`; CONEXION → `impacts`; ALTERNATIVA_HOY → `decision.options` (O2 rechazada por asientos); REEMBOLSO → `fare_conditions.refundable` + O3 rechazada; `mentions_minor` → ya cubierto por R5 | **Determinístico** (tabla intent → fuente de verdad) | La evaluación validada | Un intent sin fuente de verdad en la evaluación no se responde: se deriva |
| 5. Redactar | Compone la respuesta en lenguaje natural a partir de las frases ya validadas (`passenger_view`) y los hechos del paso 4 | **AI-assisted** (modelo sobre plantillas aprobadas) o plantillas puras en v1 | Solo `passenger_view` y los hechos del paso 4. Nunca la reserva cruda, nunca datos personales | Validación estructural antes de enviar: cada afirmación debe trazarse a un campo de la evaluación y el mensaje debe llevar `policy_ref`. Si falla, se envía la versión de plantilla |
| 6. Actuar | Si María confirma el cambio, `POST /rebooking` con idempotencia | **Human-controlled** (el pasajero) | La opción validada | 503 → humano, sin reintento |

## Qué se resuelve con IA y qué no, y por qué

**Con IA (dos puntos, ambos acotados):**

- **Entrada**: pasar de texto libre a una consulta estructurada con un esquema cerrado de intents. Es el lugar donde un modelo aporta más y arriesga menos: si se equivoca, el peor caso es responder una pregunta que no se hizo, y hay un `unknown_intent` para lo que no reconoce. Costo: una llamada corta por consulta. Latencia: aceptable, porque la consulta ya es asíncrona para el pasajero.
- **Salida**: redactar sobre hechos ya decididos. El modelo no decide nada; ordena y conecta frases que el motor ya validó. Se verifica que no agregue hechos (cada afirmación se traza a un campo) y que lleve `policy_ref`. En v1 se puede reemplazar por plantillas, que es lo implementado.

**Sin IA (todo lo demás):** recuperar contexto, resolver fuentes, calcular impacto, evaluar política, elegir opción, decidir si es automática, decidir si interviene una persona, ejecutar. Es la misma lógica para todos los pasajeros, tiene que ser auditable regla por regla, y un error cuesta dinero o un reclamo.

**Sin agente con herramientas.** Un agente que elige qué tools llamar y en qué orden no aporta aquí: el orden es siempre el mismo (reserva → eventos → política → opciones) y las escrituras tienen controles que no se pueden dejar a criterio de un modelo. La orquestación es código. El modelo nunca tiene acceso a las tools de escritura ni a la reserva cruda.

## Permisos y datos

| Componente | Lee | Escribe | Ve datos personales |
|---|---|---|---|
| Modelo de entrada (paso 1) | Texto de la consulta | Nada | Solo lo que María escriba; se le instruye ignorarlo y el esquema de salida no tiene campos libres |
| Motor (pasos 2 a 4) | Las cuatro tools de lectura | Caso humano | No: `stripPii` en la frontera |
| Modelo de salida (paso 5) | `passenger_view` y hechos validados | Nada | No |
| Endpoint de acción (paso 6) | Evaluación fresca | Solicitud de cambio, caso humano, notificación | No |

## Cómo se detecta un output incorrecto del modelo

- Paso 1: la salida debe validar contra el esquema; un intent fuera de catálogo no se inventa, cae en `unknown_intent`. Se muestrea un porcentaje de consultas para revisión humana y se mide la tasa de `unknown_intent`.
- Paso 5: validación estructural (toda afirmación traza a un campo; `policy_ref` presente; sin cifras ni horarios que no estén en la evaluación). Si falla, se usa la plantilla. Se registra el par evaluación → mensaje para auditoría.

## Respuesta a María con este diseño

> Tu vuelo LA500 a Lima saldrá a las 17:10 por un retraso, así que no alcanzarás la conexión a Ciudad de México de las 19:05. Según nuestra política de retrasos, puedes cambiar sin costo. Hoy no hay alternativa con asientos para los dos; te recomendamos el LA2412 de mañana a las 08:15, sin costo. Tu tarifa no permite reembolso. Como viajas con un menor, un agente te contactará para asistirte. Confirma el cambio desde la app o espera al agente.

Cada frase sale de un campo de la evaluación. La pregunta del colegio no se responde porque no hay fuente de verdad para ella.
