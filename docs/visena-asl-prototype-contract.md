# Prototipo de reconocimiento ASL con OpenHands (protocolo 2.0)

Este flujo permite mostrar una demostración de una glosa ASL y luego capturar la ejecución del usuario. **El video demostrativo se reproduce en el frontend y no se usa como referencia de comparación.** El backend clasifica los landmarks capturados con OpenHands BERT/WLASL2000. Para `drink` también informa qué mano se acercó a la boca. Groq redacta recomendaciones en español a partir de métricas de captura y predicciones ASL. La probabilidad del clasificador no es una nota de calidad de ejecución.

## WebSocket

`ws://127.0.0.1:8000/ws/v2/visena/recognize` (use `wss://` bajo HTTPS). Todos los mensajes JSON tienen `"protocol_version":"2.0"`. La glosa objetivo debe ser una de las clases de `backend/models/openhands/splits/asl2000.json`, por ejemplo `drink`.

```json
{
  "type": "session.start",
  "protocol_version": "2.0",
  "target_gloss": "drink",
  "practice_hand": "right",
  "capture": {"width": 640, "height": 480, "fps": 30, "frame_encoding": "jpeg"}
}
```

Respuesta: `session.ready` con `session_id`, `target_gloss`, `status: ready` y `server_build`. La página de prueba usa `server_build` para detectar un Uvicorn anterior tras actualizar el frontend. El frontend muestra primero su video o animación instructiva. Después envía `evaluation.begin`, frames binarios y `evaluation.end`. Puede repetir con `evaluation.reset` sin cerrar la cámara y terminar con `session.stop`.

## Frame binario

Cada mensaje binario es `[timestamp_ms:uint64 LE][frame_sequence:uint32 LE][JPEG]`. El timestamp y la secuencia deben ser estrictamente crecientes durante toda la conexión, incluso tras un reset. El JPEG comienza con `FF D8` y termina con `FF D9`. El backend decodifica con OpenCV y extrae landmarks con MediaPipe; no escribe `.mp4` ni `.npz` de la captura.

## Resultados

`evaluation.partial` se emite mientras llega la cámara y contiene métricas de cobertura y recomendaciones de captura. `recognition.status` es `pending` hasta terminar. `evaluation.final` espera los frames en cola, ejecuta el BERT temporal con la secuencia en memoria y devuelve:

```json
{
  "type": "evaluation.final",
  "protocol_version": "2.0",
  "session_id": "uuid",
  "target_gloss": "drink",
  "status": "complete",
  "quality": {"frames_received": 45, "frames_processed": 43, "frames_dropped": 2},
  "recognition": {
    "status": "experimental",
    "model": "OpenHands/BERT-WLASL2000",
    "target_gloss": "drink",
    "target_probability": 0.13,
    "input_window": {"frames": 32, "start_ms": 300, "end_ms": 1900, "trimmed": true, "focus_hand": "right"},
    "top_k": [{"class_id": 0, "gloss": "drink", "score": 0.13}]
  },
  "execution_score": null,
  "execution_score_status": "awaiting_validation",
  "observations": {"hand_to_mouth": true, "hands_to_mouth": {"left": false, "right": true}, "practice_hand": "right", "practice_hand_status": "matching_hand"},
  "feedback": ["Puedes practicar de nuevo cuando quieras."],
  "feedback_source": "groq",
  "feedback_status": "ok",
  "feedback_model": "openai/gpt-oss-120b",
  "feedback_summary": "La cámara registró tu seña para este intento.",
  "feedback_recommendations": ["Puedes practicar de nuevo cuando quieras."],
  "feedback_http_status": 200,
  "feedback_diagnostic": null,
  "services": {"mediapipe": "used", "asl_model": "used", "groq": "used"},
  "warnings": ["El modelo ASL no compara la captura con el video demostrativo; sus probabilidades no miden calidad de ejecución."]
}
```

Los números son ilustrativos. `target_probability` y `top_k[].score` son probabilidades del modelo sin calibración para esta cámara, **no puntuaciones de ejecución**. El campo `execution_score` permanece `null` y `execution_score_status` vale `awaiting_validation` hasta disponer de ejemplos etiquetados para calibrar y probar una nota de ejecución. Si faltan landmarks esenciales, `recognition.status` será `insufficient_data`, no se ejecutará el clasificador y el feedback indicará qué mejorar en la captura. El torso requiere 70 % de cobertura sin huecos mayores a 0,35 s. Basta detectar una mano durante al menos 0,25 s y cuatro fotogramas, sin huecos interiores mayores a 0,35 s; no se exige verla durante el reposo anterior o posterior a la seña. La calidad reporta la cobertura y los huecos de toda la toma. Para `drink`, si se observó la mano solicitada acercarse a la boca, BERT recibe el intervalo desde la primera hasta la última cercanía, con 0,8 segundos de margen a cada lado; se suprimen los landmarks de la otra mano. `input_window` informa el intervalo y `focus_hand`. En los demás casos se usa la selección general por movimiento de muñecas. La secuencia seleccionada se muestrea uniformemente a 120 imágenes antes de normalizar con los hombros, como en el entrenamiento del checkpoint.

`practice_hand` es opcional en `session.start` y acepta `left`, `right` o `either` (valor predeterminado). Para `drink`, `observations.hands_to_mouth` informa cada lado y `practice_hand_status` vale `matching_hand`, `opposite_hand`, `observed` o `not_observed`. Es una observación geométrica del movimiento de muñeca, no una confirmación de la forma y orientación de toda la seña. La prueba local pide `right` para distinguir el error de mano opuesta; otros clientes pueden permitir `either`. No se infiere un error del usuario solo porque BERT propone otra glosa.

La página de prueba distingue toma insuficiente, fallo de procesamiento, mano indicada, mano opuesta y clasificación inconclusa. En ningún estado interpreta la probabilidad como nota de ejecución. Cuando Groq devuelve una respuesta válida y clara, sus `feedback_recommendations` aparecen en el resultado principal. El servidor fija `feedback_summary` a partir de los hechos observados para evitar que una frase de Groq convierta una sugerencia del clasificador en un veredicto. El servidor descarta consejos con tecnicismos o afirmaciones no comprobadas y usa frases locales sencillas. Las métricas, clases alternativas, origen del feedback y JSON completo están disponibles en apartados desplegables para diagnóstico.

Si falla el modelo, se envía `INFERENCE_ERROR` y el resultado final marca `recognition.status: error`. Groq se consulta para redactar recomendaciones siempre que esté configurado, incluso cuando BERT propone otra glosa. En ese caso el servidor fija un resumen incierto, ya que Groq no ve el video y no puede diagnosticar la forma o velocidad de la seña. La corrección de mano opuesta también se conserva por reglas. `services` muestra qué componentes se usaron; `feedback_source`, `feedback_status` y `feedback_model` muestran el origen y resultado de los consejos. `feedback_http_status` y `feedback_diagnostic` guardan la causa técnica para diagnóstico, con claves ocultadas. Si Groq rechaza el esquema estricto, se intenta modo JSON y luego una respuesta sin modo forzado, siempre validada localmente. Solo se envían a Groq la glosa, la predicción y métricas agregadas; no se envían fotos, video ni landmarks.

## Configurar Groq

La clave se lee de la variable de entorno `GROQ_API_KEY` **en el servidor**. No la coloque en TypeScript ni en el navegador. En Windows, desde `backend/`, ejecute `./start_with_groq.ps1`; el script pedirá la clave sin mostrarla, habilitará la página local de prueba y arrancará Uvicorn. Si el puerto 8000 ya está ocupado, el script indicará el proceso que debe detener antes de iniciar la versión nueva. Si ya configura variables de entorno de otro modo, arranque Uvicorn normalmente. El modelo predeterminado es `openai/gpt-oss-120b`, configurable con `VISENA_GROQ_MODEL`; `VISENA_GROQ_TIMEOUT_SECONDS` limita la espera (12 segundos por defecto) y `VISENA_GROQ_FEEDBACK_ENABLED=false` desactiva Groq. Si no hay clave o Groq falla, el resultado final usa recomendaciones locales con `feedback_status: unavailable | error`. El WebSocket acepta los orígenes locales de los puertos 8000 y 5500 por defecto; configure `VISENA_ALLOWED_ORIGINS` con los orígenes de su frontend separados por comas al desplegarlo.

## Heartbeat, reconexión y límites

Tras `VISENA_HEARTBEAT_SECONDS` de inactividad, el servidor envía `session.ping`; responda `session.pong`. Otro intervalo de silencio cierra la conexión. Una reconexión crea una sesión nueva; reenvíe `session.start` y `evaluation.begin`, sin reusar frames viejos. Rigen `VISENA_MAX_INPUT_FPS=30`, `VISENA_MAX_FRAME_QUEUE=3`, `VISENA_EVALUATION_INTERVAL_MS=250`, `VISENA_BUFFER_SECONDS=6`, `VISENA_MAX_FRAME_BYTES=1000000`, resolución máxima `1920×1080`, cobertura experimental mínima de torso `70%` y mayor hueco `0.35 s`. Si la cola se llena, se descarta el frame más antiguo. La inferencia OpenHands se ejecuta al finalizar y puede tardar varios segundos porque el entorno del modelo carga el checkpoint para cada intento. Las inferencias GPU se serializan por proceso para evitar ejecutarlas simultáneamente; una espera superior a 30 segundos devuelve `INFERENCE_ERROR`.

## Errores

`{"type":"error","protocol_version":"2.0","session_id":null,"code":"TARGET_NOT_SUPPORTED","message":"La glosa no está en WLASL2000.","recoverable":false}`. Otros códigos: `INVALID_MESSAGE`, `INVALID_FRAME`, `INVALID_TIMESTAMP`, `SESSION_NOT_READY`, `EVALUATION_NOT_STARTED`, `PROCESSING_ERROR`, `INFERENCE_ERROR`, `INTERNAL_ERROR`. No se exponen stack traces.

## Prueba manual

Desde `backend/`, ejecute `./start_demo.ps1` para la práctica sin Groq o `./start_with_groq.ps1` para añadir consejos redactados con Groq. Ambos instalan o verifican los modelos; `check_groq.py` permite comprobar la clave por separado. Abra `http://127.0.0.1:8000/manual-test/camera.html`. La página propone **DRINK (beber)** con la mano derecha y enlaza a una página externa con dos variantes; esta prueba indica usar la primera, el verbo. Regrese a la página y pulse **Abrir cámara**. Tras conceder el permiso, tiene cinco segundos para colocar la mano en cuadro; la captura automática dura 5,5 segundos y comienza tras la confirmación del servidor. Mantenga la pestaña visible: ocultarla cancela la toma. El contador muestra las imágenes enviadas y se solicita reintentar si no llegan al menos 16. El backend no recibe el video instructivo. La [evaluación local](model-evaluation.md) documenta el resultado con seis videos y sus límites.
