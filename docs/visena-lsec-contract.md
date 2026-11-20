# Integración LSEC con el frontend

Para ejecutar el sistema completo y comprobar la primera toma con cámara, consulta la [guía de arranque y funcionamiento](guia-arranque-y-funcionamiento.md).

El API de Viseña recibe una ejecución completa como puntos de MediaPipe y usa el catálogo LSEC para sugerir glosas o comparar la ejecución con una referencia elegida. Usa los mismos identificadores, fotogramas, unidades y segmentos de los esquemas 1.1.0 del frontend. El clasificador de ASL es un servicio de prototipo independiente.

- [Tipos TypeScript](../frontend-contract/visena-lsec.types.ts) y [cliente de ejemplo](../frontend-contract/example-lsec-client.ts)
- [Esquema de referencia](../frontend/data/schemas/referencia.schema.json) y [esquema de ejecución](../frontend/data/schemas/ejecucion.schema.json)
- [Inventario CONADIS del frontend](../frontend/docs/lote-1-lsec-conadis-2026-10-30.json)

## Endpoints

Usar el prefijo `/api/v1/lsec` en el mismo origen con Caddy. En desarrollo directo, usar `http://127.0.0.1:8000/api/v1/lsec`. La especificación OpenAPI se obtiene del backend en `/openapi.json` y se puede explorar en `/docs`.

| Método | Ruta               | Respuesta                                                                                                                                        |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/catalogo`        | Estado y procedencia de cada seña, incluidas las 40 fichas del inventario. Los estados son `pendiente_referencia`, `experimental` y `publicada`. |
| GET    | `/referencias`     | Arreglo de referencias revisadas en el formato que consume el reproductor, con sus pistas para el avatar.                                        |
| POST   | `/reconocimientos` | Hasta tres glosas candidatas ordenadas por menor distancia geométrica.                                                                           |
| POST   | `/evaluaciones`    | Distancias por parámetro para el `id_referencia` solicitado, más el documento de ejecución si hay datos suficientes y calibración.               |

Los POST reciben `application/json` y solo aceptan landmarks. La captura se compara en memoria y no se guarda en la base de datos ni en archivos. `/api/ready` comprueba PostgreSQL de forma independiente. Los endpoints LSEC pueden operar sin PostgreSQL.

## Captura

El espejo ofrece **Probar seña** al comenzar un nivel. En una demostración se compara la toma con el lote experimental por HTTPS. En una referencia publicada se evalúa el objetivo con el motor TypeScript y su plantilla. La última publicación y las plantillas revisadas ya consultadas se pueden reutilizar sin red. Los fotogramas de participantes permanecen fuera de esa caché.

`GET /plantillas/{id_referencia}` entrega puntos, dimensiones, lateralidad, intervalo del video original cuando está disponible, estado de revisión, requisitos faciales y calibración. El cliente obtiene una plantilla mediante `clienteLsec().plantilla(id)`. `evaluarLocal(plantilla, intento)` usa esa plantilla en memoria y devuelve el contrato de evaluación. [Motor TypeScript](../frontend-contract/motor-lsec.ts)

`POST /segmentaciones` recibe el intento completo sin segmento previo. Devuelve `detectado` con los índices inclusivos y la mano observada, o `datos_insuficientes`. Usa altura de la mano, hombros y continuidad del seguimiento. Los índices corresponden a la captura enviada. El espejo llama a `POST /reconocimientos?segmentar=true` para segmentar y comparar con una sola transmisión de landmarks.

En desarrollo con Vite, `/api` se deriva a `http://127.0.0.1:8000`. La variable `VISENA_API_ORIGIN` permite cambiar el destino. En Compose el proxy es Caddy.

Construir cada `FrameCaptura` con `frameLsec` a partir de los landmarks de `VisionService.detect`. Usar los nombres existentes del anotador si ya se trabaja con sus fotogramas.

- Enviar `schema_version: "1.1.0"`, `ancho` y `alto` del video original, más entre 4 y 300 `frames` dentro de 20 segundos. El límite del JSON es 10 MiB.
- Usar índices consecutivos desde 0 y tiempos estrictamente crecientes en milisegundos. `segmentacion` es opcional y sus extremos son inclusivos. Al omitirla se usa toda la captura. Para obtener resultados comparables, enviar el gesto aislado o indicar su intervalo.
- Enviar coordenadas tal como las entrega MediaPipe antes de aplicar el espejo visual. Las manos son izquierda y derecha anatómicas. Para una seña de una mano se compara el lado de la referencia. Para una variante unilateral que admite alternancia, indicar mano_practica. El motor solo refleja las pistas manuales cuando la plantilla declara permite_alternancia_manual. Las referencias bimanuales conservan ambos lados anatómicos.
- Omitir pistas no detectadas. Se necesitan los 33 puntos de pose para normalizar con los hombros y los 21 puntos de cada mano requerida. El backend no requiere que ambas manos estén visibles en señas de una mano.
- Cuando una referencia exige expresión facial, enviar `blendshapes_rostro`. El subconjunto de `rostro` no sustituye esos coeficientes. `pose_world` y `vrm_pose_override` se conservan en los documentos para el avatar.

Para `/evaluaciones`, añadir `id_referencia`, por ejemplo `ref-hola`. Usar opcionalmente `modo`; el valor por defecto es `practica_libre`.

## Resultados y estados

- `reconocimientos.estado: "experimental"` indica que el ranking contiene candidatas con cobertura suficiente. La distancia promedia cuatro parámetros manuales y una distancia menor indica mayor similitud. El ranking compara únicamente con el catálogo cargado y puede sugerir una glosa al recibir un movimiento ajeno al catálogo.
- `evaluaciones.estado: "evaluado"` incluye `ejecucion.resultado` y respeta el esquema de ejecución 1.1.0. El puntaje se calcula con los umbrales específicos de esa referencia. La respuesta indica las zonas anatómicas correspondientes a las desviaciones. Un prosoponema `no_aplica` aparece como neutro en el documento de ejecución, con el mensaje «Sin requisito facial» y sin afectar el puntaje.
- `evaluaciones.estado: "sin_calibracion"` incluye las distancias disponibles y `ejecucion: null`. Mostrar las observaciones con su condición experimental. Las tolerancias de la anotación describen el gesto y se calibran por separado de las distancias DTW.
- `datos_insuficientes` permite solicitar otra captura. Una pista requiere cuatro cuadros válidos como mínimo, cobertura del 70 % y huecos de hasta 350 ms. La falta de datos nunca produce un veredicto negativo.
- `sin_referencias` indica que no hay plantillas cargadas para reconocimiento. HTTP 404 con `detail.codigo: "referencia_no_disponible"` indica que la referencia elegida todavía no tiene plantilla. HTTP 503 con `detail.codigo: "catalogo_no_disponible"` indica que falló la carga de un paquete configurado.
- HTTP 413 indica que se superó el tamaño permitido, HTTP 415 indica que el contenido no es el JSON de landmarks y HTTP 422 identifica los campos inválidos.

`latencia_ms` mide preparación y comparación en el backend. La métrica de extremo a extremo del frontend debe medirse desde que termina la captura hasta que aparece el resultado.

## Preparar el lote de laboratorio

Usar los clips locales identificados por `video_id` o `id_propuesto` del inventario. El extractor utiliza en CPU los mismos modelos Pose, Hand y Face del frontend. Escribe un paquete experimental con metadatos, intervalo original, pistas y segmento. Las referencias que no superan la cobertura se informan por separado.

Desde `backend/` con Python 3.14 y las dependencias de `requirements.txt` instaladas:

```powershell
.\.venv\Scripts\python.exe prepare_lsec.py data/references/conadis-lote1/clips data/lsec/borrador-conadis-lote1.json --version conadis-lote1-piloto-1
$env:VISENA_LSEC_DRAFTS = (Resolve-Path data/lsec/borrador-conadis-lote1.json).Path
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Con `yt-dlp` disponible, añadir `--descargar` para obtener los clips públicos faltantes desde los enlaces del inventario.

Para corregir un tramo automático, pasar `--intervalos ruta.json` con un diccionario por ID. Cada valor contiene `inicio` y `fin` inclusivos en índices de los cuadros muestreados por el extractor y `mano_dominante` con valor `izquierda`, `derecha` o `ambas`.

El catálogo experimental se habilita explícitamente con `VISENA_LSEC_DRAFTS`. En Compose, el directorio local `backend/data/lsec` se monta en `/workspace/backend/data/lsec`; usar la ruta correspondiente dentro del contenedor. Los clips y los datos generados pertenecen al paquete de laboratorio local y no se incluyen en Git.

## Publicar referencias y puntuaciones

Guardar el lote revisado en `backend/data/lsec/catalogo.json` o indicar otro archivo con `VISENA_LSEC_CATALOG` al ejecutar Uvicorn. El contenedor carga el archivo del directorio montado. El objeto principal contiene `version` y un arreglo `referencias`. Cada entrada contiene:

| Campo           | Contenido                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ancho`, `alto` | Dimensiones originales del material usado para la extracción.                                                                           |
| `fuente_url`    | URL de procedencia de esa referencia.                                                                                                   |
| `referencia`    | Objeto completo que cumple el esquema `ReferenciaSena` 1.1.0, con anotación fonológica, metadatos y segmento revisados.                 |
| `revision`      | Objeto con `especialista`, `fecha` con zona horaria y `procedencia` que identifique la muestra y variante aceptadas.                    |
| `calibracion`   | Opcional. Incluye `puntaje_minimo` entre 0 y 100 y `umbrales`, un mapa por parámetro aplicable con cotas de distancia `verde` y `rojo`. |

El backend comprueba que el archivo cumple el esquema, que índices y tiempos concuerdan y que las pistas requeridas tienen cobertura. Una referencia revisada puede aparecer en el reproductor aunque su evaluación calibrada siga pendiente. Si un ID existe en ambos paquetes, se usa la versión revisada. Actualizar el archivo completo de forma atómica y cambiar su versión cuando cambien sus referencias o umbrales.

## Verificación del piloto

Se extrajeron 40 referencias, diez por temática, con segmentación automática. Se reprodujeron sus landmarks a través de Caddy HTTPS y FastAPI. Las 40 referencias quedaron en primer lugar al reinyectar sus propios landmarks y las 40 evaluaciones devolvieron `sin_calibracion`. La mediana local fue de 5,6 ms en el motor de evaluación dirigida y 203,9 ms por solicitud HTTPS de reconocimiento.

Se reextrajeron HOLA, FAMILIA, ROJO y UNO después de cambiar el encuadre del clip original. Las cuatro glosas quedaron en primer lugar. Quedan pendientes la revisión lingüística de los segmentos y variantes, una prueba con cámara y participantes independientes, y la calibración de las puntuaciones.
