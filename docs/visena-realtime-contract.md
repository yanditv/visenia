# Contrato VISENA en tiempo real (v1.0)

> **Legacy/demo:** este contrato compara la captura con secuencias `.npz` guardadas. El flujo basado en OpenHands usa el [contrato ASL experimental v2](visena-asl-prototype-contract.md).

## Arquitectura y arranque

El navegador envía JPEG individuales a `ws://localhost:8000/ws/v1/visena/evaluate` (use `wss://` bajo HTTPS). Cada conexión crea un MediaPipe Holistic Landmarker en modo VIDEO, una cola de frames, un buffer de landmarks y un worker propios. Los cinco parámetros se comparan con la referencia en memoria usando DTW. No se escriben videos ni landmarks de la sesión al disco. Los endpoints HTTP de carga de video son **legacy/deprecated** para regresión y depuración; el frontend nuevo usa WebSocket.

Ejecute desde `backend/`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`GET /health` responde sin cargar el modelo ni hacer inferencia. El archivo `frontend-contract/example-client.ts` muestra una integración con `getUserMedia`. Para pruebas: `cd backend; .\.venv\Scripts\python.exe -m pytest -q`.

Para una prueba manual sin frontend, ejecute también desde `backend/` `.\.venv\Scripts\python.exe -m http.server 5500 --directory manual-test` y abra `http://localhost:5500/camera.html`. Use los botones de la página para conectar la cámara, comenzar y finalizar.

## Ciclo de vida

1. Abra el WebSocket y envíe `session.start` como primer mensaje de texto JSON. Espere `session.ready`. El `reference_id` debe existir en `backend/data/references/catalog.json` y tener archivos procesado y preprocesado.
2. Envíe `evaluation.begin`; espere `evaluation.started`. La cámara puede permanecer encendida durante varios intentos.
3. Envíe frames binarios. El backend publica `evaluation.partial` cada `VISENA_EVALUATION_INTERVAL_MS` de tiempo de captura procesado.
4. Envíe `evaluation.end` y espere `evaluation.final`. Se procesan los frames ya en cola antes de emitir el final.
5. Envíe `evaluation.reset` para descartar la ejecución y luego `evaluation.begin` para otro intento. `session.stop` cierra y libera los recursos. La desconexión inesperada también los libera.

Todos los mensajes JSON, en ambas direcciones, llevan `"protocol_version":"1.0"`. Los mensajes incompatibles de inicio cierran la conexión. Los mensajes de control inválidos producen un error recuperable.

## Inicio

```json
{
  "type": "session.start",
  "protocol_version": "1.0",
  "reference_id": "df30009dba754c2e876b505bc63aad4b",
  "demo_mode": false,
  "capture": {"width": 1280, "height": 720, "fps": 30, "frame_encoding": "jpeg"}
}
```

Respuesta: `{"type":"session.ready","protocol_version":"1.0","session_id":"uuid","reference_id":"...","status":"ready"}`.

`demo_mode:true` solo se acepta cuando el servidor tiene `VISENA_DEMO_MODE=true`. Los scores son matemáticos de demostración, sin calibración LSEC. Con `demo_mode:false`, `demo_score` siempre es `null`; las distancias DTW siguen disponibles si hay suficientes datos.

## Frame binario

Un mensaje WebSocket binario contiene **12 bytes de cabecera seguidos de un JPEG completo**:

| Offset | Tamaño | Tipo | Descripción |
| --- | ---: | --- | --- |
| 0 | 8 | `uint64` little endian | `timestamp_ms`, monotónico durante toda la conexión |
| 8 | 4 | `uint32` little endian | `frame_sequence`, estrictamente creciente |
| 12 | N | JPEG | Desde `FF D8` hasta `FF D9` |

El timestamp representa tiempo monotónico de captura, por ejemplo `Math.round(performance.now() - origin)`. Nunca reinicie el contador ni el timestamp tras `evaluation.reset`. El cliente puede construir la cabecera con `DataView.setBigUint64(0, BigInt(timestamp), true)` y `setUint32(8, sequence, true)`. No use Base64. El JPEG debe respetar el límite de bytes y resolución; el backend valida la decodificación con OpenCV.

## Mensajes de control

Cada uno usa la forma `{"type":"evaluation.begin","protocol_version":"1.0"}`. Tipos: `evaluation.begin`, `evaluation.end`, `evaluation.reset`, `session.stop`, `session.pong`. Respuestas de confirmación: `evaluation.started`, `evaluation.reset`, `session.stopped`. Los frames antes de `evaluation.begin` producen `EVALUATION_NOT_STARTED`.

## Resultados

`evaluation.partial` y `evaluation.final` llevan `session_id`, `reference_id`, `frame_sequence`, `timestamp_ms`, `quality`, `parameters`, `overall`, `recognition` y `warnings`. `frame_sequence` y `timestamp_ms` son `null` cuando todavía no se procesaron frames. El estado superior es `partial` para actualizaciones y `complete` al finalizar una ejecución; **la suficiencia de datos se expresa en cada parámetro y en `overall`**.

Los parámetros son `handshape`, `orientation`, `location`, `movement`, `non_manual`. Cada uno tiene `status: ok | partial | insufficient_data | error`, `distance: number | null` y `demo_score: number | null` cuando corresponde. `handshape` y `orientation` incluyen `hands.left_hand` y `hands.right_hand`; cada mano tiene calidad de referencia y candidato, distancia y score nulo. La calidad incluye porcentaje de cobertura, frames válidos/totales y mayor hueco sin detección en segundos. La calidad global incluye cobertura por región, `frames_received`, `frames_processed`, `frames_dropped`, `processing_latency_ms` y `evaluation_latency_ms`.

`overall.demo_score` solo existe cuando **todos** los parámetros y las manos requeridas son suficientes y el modo demo está habilitado. No se sustituye un dato faltante por cero. `recognition` siempre indica `status: experimental`, modelo `WLASL` y `top_k: []`: no hay inferencia OpenHands en streaming ni afirmación de reconocimiento LSEC. La clasificación WLASL de los endpoints legacy no participa en esta evaluación.

## Errores

```json
{"type":"error","protocol_version":"1.0","session_id":"uuid opcional","code":"INVALID_FRAME","message":"No se pudo decodificar el frame JPEG.","recoverable":true}
```

Los códigos previstos son `INVALID_MESSAGE`, `INVALID_FRAME`, `INVALID_TIMESTAMP`, `REFERENCE_NOT_FOUND`, `SESSION_NOT_READY`, `EVALUATION_NOT_STARTED`, `BUFFER_OVERFLOW`, `PROCESSING_ERROR`, `INFERENCE_ERROR`, `INTERNAL_ERROR`. La cola saturada descarta el frame más antiguo e incrementa `frames_dropped`; no envía un error por cada descarte. Los errores de inicio incompatibles son no recuperables. Nunca se envían stack traces.

## Heartbeat y reconexión

Tras `VISENA_HEARTBEAT_SECONDS` sin mensajes entrantes, el servidor envía `session.ping`. El cliente responde `session.pong` con versión `1.0`. Otro intervalo completo de silencio cierra la conexión. Al reconectar, envíe un nuevo `session.start` y luego `evaluation.begin`: el buffer anterior no se conserva. No reenvíe frames viejos.

## Límites y configuración

Variables de entorno (valores iniciales, experimentales): `VISENA_MAX_INPUT_FPS=30`, `VISENA_MAX_FRAME_QUEUE=3`, `VISENA_EVALUATION_INTERVAL_MS=250`, `VISENA_BUFFER_SECONDS=4`, `VISENA_MAX_FRAME_BYTES=1000000`, `VISENA_MAX_WIDTH=1920`, `VISENA_MAX_HEIGHT=1080`, `VISENA_DEMO_MODE=false`, `VISENA_MIN_HAND_LANDMARKS_CONFIDENCE=0.5`, `VISENA_MIN_COVERAGE=0.70`, `VISENA_MAX_MISSING_GAP_SECONDS=0.35`, `VISENA_HEARTBEAT_SECONDS=15`. El servidor descarta frames que exceden la frecuencia y frames antiguos cuando la cola se llena. La ventana final contiene hasta los últimos cuatro segundos: el cliente debe terminar una seña dentro del buffer configurado. Los umbrales y scores no están validados para LSEC. No se aplica interpolación nueva a candidatos en streaming; los huecos siguen siendo `NaN` y sus máscaras originales se reportan.
