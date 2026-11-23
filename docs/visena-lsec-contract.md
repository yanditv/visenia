# API LSEC

La API utiliza el prefijo /api/v1/lsec, JSON y contratos de captura 1.1.0. FastAPI publica la especificación completa en /openapi.json y una interfaz en /docs. Los tipos y el cliente TypeScript están en contracts/typescript.

## Catálogo y cálculo

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | /catalogo | Inventario, estado de referencia y calibración. |
| GET | /referencias | Referencias publicadas para el reproductor. |
| GET | /plantillas/{id} | Puntos, lateralidad, dimensiones, procedencia y calibración. |
| POST | /segmentaciones | Delimitar un gesto en una toma completa. |
| POST | /reconocimientos?segmentar=true | Calcular hasta tres coincidencias y similitud. |
| POST | /evaluaciones?segmentar=true | Calcular distancias, similitud y evaluación calibrada del objetivo. |

Las rutas de cálculo procesan en memoria. La aplicación utiliza /practicas para guardar el resultado como parte de la operación.

## Captura

Una toma incluye schema_version con valor 1.1.0, ancho, alto y frames. Cada cuadro contiene frame_idx, timestamp_ms y pistas opcionales de pose (33 puntos), mano_derecha y mano_izquierda (21 puntos), pose_world y blendshapes_rostro. Las coordenadas son las que entrega MediaPipe antes del efecto de espejo.

Los índices empiezan en cero y los tiempos crecen estrictamente. Se admiten de 4 a 300 cuadros en hasta 20 segundos y cuerpos de hasta 10 MiB. La segmentación usa extremos inclusivos. Con segmentar=true, envía la captura completa sin una segmentación previa. Para enviar un segmento explícito, usa segmentar=false.

El campo mano_practica puede indicar izquierda o derecha. La alternancia se aplica únicamente a referencias configuradas para permitirla.

## Persistencia

Estas rutas requieren X-Participant-Key con 64 caracteres hexadecimales minúsculos. El navegador genera la clave mediante un generador criptográfico y la guarda localmente.

| Método | Ruta | Uso |
| --- | --- | --- |
| POST | /practicas | Calcular y guardar un intento idempotente. |
| GET | /practicas?limite=20&offset=0 | Historial paginado. Admite id_referencia. Límite máximo 100. |
| GET | /practicas/{id_intento} | Detalle del propio intento. |
| GET | /trayectoria | XP, intentos calificados de hoy, meta y racha. |
| POST | /feedback/{id_intento} | Recibe un cuerpo JSON vacío y devuelve consejo local o de Groq para un intento propio. |
| GET | /progreso | Intentos, cantidad calificada, promedio, mejor nota y última fecha por seña. |
| GET | /exportaciones?formato=json | Todos los resultados de esa identidad. También admite csv. |

El POST recibe la captura y los siguientes campos:

~~~json
{
  "schema_version": "1.1.0",
  "id_intento": "7f34921f-ff45-4d65-9086-17004e9a5603",
  "id_referencia": "ref-hola",
  "segmentar": true,
  "ancho": 640,
  "alto": 480,
  "frames": []
}
~~~

En el ejemplo, reemplaza frames por al menos cuatro cuadros válidos. Omite id_referencia para reconocimiento libre. El resultado incluye id_intento, timestamp_utc, tipo, id_referencia, glosa, captura con métricas agregadas y resultado con la evaluación o el reconocimiento.

Reintenta con el mismo ID y contenido cuando se pierda una respuesta. El servidor devuelve el registro confirmado y conserva una sola fila incluso con solicitudes concurrentes. Otro contenido con el mismo ID devuelve 409. Cada identidad solo consulta sus propios resultados. Una captura insuficiente también queda registrada con nota nula.

El documento persistido omite las coordenadas. El arreglo ejecucion.frames_ejecucion queda vacío en esta ruta. Las rutas de cálculo conservan el contrato completo para consumidores que necesiten los cuadros en memoria.

GET /feedback/estado indica si hay una clave configurada en `groq_disponible`. La validación de la clave ocurre al solicitar el consejo. La generación conserva la calificación. El resultado incluye `fuente`, `estado` y `consejo`. El estado `cuota_agotada` acompaña el consejo local cuando Groq responde con HTTP 429.

## Resultados

El objeto similitud incluye ID de referencia, glosa, puntaje de 0 a 100, notas por parámetro, consejo y zonas a resaltar. La fórmula y sus escalas están descritas en [Proyecto](PROYECTO.md).

Una evaluación tiene estado evaluado, sin_calibracion o datos_insuficientes. El estado sin_calibracion puede incluir una nota geométrica. El campo ejecucion.resultado aparece al existir calibración educativa. Una captura insuficiente devuelve similitud y ejecución nulas.

El reconocimiento tiene estado experimental, datos_insuficientes o sin_referencias. Las candidatas se ordenan por distancia normalizada ascendente. El modo libre necesita medir también movimientos ajenos al catálogo para evaluar el rechazo de señas desconocidas.

## Referencias publicadas

El archivo contiene version y una lista referencias. Cada elemento tiene ancho, alto, fuente_url, referencia, revision y, opcionalmente, calibracion.

El objeto referencia cumple contracts/schemas/referencia.schema.json. La revisión identifica especialista, fecha con zona horaria y procedencia. La calibración contiene puntaje_minimo y umbrales con límites verde y rojo por parámetro aplicable. Los valores son distancias del motor y requieren calibración con muestras independientes.

## Errores y disponibilidad

| Código | Situación |
| --- | --- |
| 404 | Referencia o intento propio ausente. |
| 409 | ID de intento reutilizado con otro contenido o propietario. |
| 413 | Cuerpo superior a 10 MiB. |
| 415 | Tipo de contenido distinto de JSON para una captura. |
| 422 | Captura, parámetros o clave de identidad inválidos. |
| 503 | Catálogo o almacenamiento configurado indisponible. |

GET /api/health, /api/ready y /api/version permiten comprobar servicio, persistencia y versión. Los detalles internos y credenciales quedan fuera de los errores de API.
