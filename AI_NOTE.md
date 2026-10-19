# AI Usage & Decision Note

## Herramientas y para qué

- **Claude Code (Claude Fable 5.1)** como única herramienta de IA, en terminal, sobre el repositorio. Para: leer el enunciado y listar lo que escondían los datos; proponer una decisión por cada ambigüedad con sus alternativas, riesgos y a quién preguntar; generar el código y los tests a partir de las decisiones tomadas; redactar borradores de estos documentos; reconstruir el registro de tiempo desde los timestamps de las sesiones.
- Sin IA en runtime del producto (ver README, "Sin IA en runtime").

## Cómo trabajé con ella

Método fijado al inicio: la IA propone, yo acepto, rechazo o modifico, y no paso a la siguiente decisión hasta entenderla lo suficiente como para defenderla sin ayuda. La IA me hizo confirmar cada decisión con mis palabras y me corrigió cuando mi justificación era incompleta o errónea.

## Outputs aceptados, rechazados o modificados

| Qué propuso la IA | Qué hice | Cómo lo validé |
|---|---|---|
| Entregar las cinco ambigüedades resueltas en bloque | **Rechazado.** Pedí ir una por una con ejemplos | Me di cuenta de que las había aceptado sin entenderlas |
| Que yo delegara las decisiones de negocio "porque la IA razona mejor" (idea mía) | **La IA la rechazó** y me mostró que el PDF evalúa justamente no delegar el criterio | Releí la sección 8 del enunciado |
| A1: relevancia por impacto, con margen de conexión supuesto | **Aceptado.** Pregunté antes si el PDF permitía asumir datos que no trae | Sección 4 y último párrafo del enunciado lo piden explícitamente |
| A2: mostrar solo lo necesario; riesgo "ocultar demasiado" | **Aceptado con modificación.** Rechacé el riesgo: el mensaje simple es el correcto; el riesgo es prometer algo no verificado | Comparé las dos versiones del mensaje a María |
| A3: seis chequeos para automatizar | **Aceptado** tras pedir una segunda explicación con ejemplos más simples | Verifiqué que O2 cae por un asiento para dos pasajeros |
| A4: R5 en paralelo, el pasajero confirma, 503 a humano | **Aceptado.** Mi primera justificación ("hay un niño") era incompleta; la IA me corrigió: lo que se informa no depende de la aprobación pendiente | Contrasté con el caso de compensación (R4), donde sí se espera |
| A5: degradadas fuera, ranking, frescura como desempate, conflicto a humano | **Aceptado.** Leí mal la primera vez ("no hay fuentes confiables"); la IA me corrigió: la fuente del evento ON_TIME es la degradada | Revisé los metadatos de `get_operational_events` |
| Código y tests generados desde las decisiones | **Aceptado** tras revisar la salida del caso base y las razones de rechazo de cada opción | 28 tests, typecheck, ejecución manual con curl |
| Todo el código en inglés | **Modificado.** Identificadores en inglés, todo lo legible por personas en español | El comité lee en español |

## Decisiones que tomé personalmente

Track Backend. Las cinco ambigüedades, con sus alternativas descartadas. Sin IA en runtime. Idioma de los entregables. Cómo reportar el tiempo. Dos decisiones de implementación las tomó la IA y me las reportó: que el endpoint de cambio vuelva a evaluar antes de escribir, y que el motor nunca reciba datos personales; las acepté.

## Qué información nunca entregaría a un modelo

Datos personales del pasajero que la tarea no necesita: documento de identidad, correo, teléfono, nombre. En este slice el motor de decisión los descarta en la frontera y un test falla si aparecen. Tampoco credenciales ni tokens de los sistemas, ni el enunciado del proceso de selección marcado como uso interno: la IA lo leyó en mi máquina, pero no va al repositorio público. Si en el futuro un modelo redactara mensajes, recibiría solo la evaluación ya decidida y plantillas aprobadas, nunca el contexto crudo de la reserva.
