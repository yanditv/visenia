# Proyecto Viseña LSEC

## Alcance

Viseña permite practicar una seña aislada con cámara, reproducir una guía en avatar VRM o esqueleto y recibir una nota de similitud, consejos y resaltado del espejo. Las 40 referencias experimentales están organizadas en cuatro unidades. Otras temáticas de la interfaz se habilitan al incorporar sus referencias.

La aplicación atiende práctica dirigida, reconocimiento libre, anotación y exportación de referencias, historial por navegador, progreso y exportación de resultados. La calificación educativa usa referencias publicadas con calibración propia. La aceptación de las 40 referencias, las variantes lingüísticas, la reconocibilidad del avatar y la precisión con participantes independientes requieren revisión humana.

## Estructura

~~~text
backend/
  app/
    main.py                  # composición de FastAPI, CORS y errores
    api/                     # rutas HTTP, dependencias y límites de captura
    contracts/               # modelos Pydantic de entrada y salida
    domain/lsec/             # catálogo, métricas, reconocimiento y evaluación
    services/                # casos de uso de práctica y coaching
    integrations/            # cliente HTTP de Groq
    repositories/            # resultados, historial y caché de consejos
    db.py                    # conexiones, transacciones y migraciones
  resources/                 # inventario y plantillas experimentales
  scripts/                   # extracción de nuevas referencias
  tests/                     # API, paridad y persistencia
frontend/
  app/
    views/                   # inicio, mapa, práctica, historial y cabecera
    src/
      catalogo/              # referencias, temáticas y selección de niveles
      practica/              # captura, evaluación y vista de resultados
      progreso/              # historial, exportación, meta diaria, racha y XP
      interfaz/              # animaciones, iconos y menús de cabecera
      anotador/              # anotación y descarga de referencias
      preferencias/          # tamaño de texto, contraste y mano dominante
      camera/ vision/ render/ avatar/  # servicios multimedia
      styles/                # Tailwind, tokens y estilos por pantalla
      main.ts                # navegación y coordinación de la sesión
    public/models/           # MediaPipe y avatar VRM
    tests/                   # interfaz, cámara, animación y funcionamiento offline
contracts/
  schemas/                   # JSON Schema de referencia y ejecución 1.1.0
  typescript/                # cliente HTTP, tipos, motor local y verificador
deploy/                      # Docker Compose, Caddy y configuración local
docs/                        # proyecto, API y fuentes
~~~

Vite compone las vistas y compila Tailwind. Los componentes de cada función consumen el cliente HTTP de `contracts/typescript/`. Los estilos del avatar y del espejo incluyen reglas específicas para sus superficies de renderizado.

Motion anima la aparición de vistas, menús y resultados. El módulo de interfaz respeta la preferencia de movimiento reducido del sistema. Lucide aporta los iconos de los controles. Vite empaqueta ambas bibliotecas con la aplicación.

FastAPI valida las solicitudes y traduce errores. Los casos de uso coordinan la evaluación, el almacenamiento y el coach. El dominio geométrico comparte convenciones y pruebas de paridad con el motor TypeScript. El repositorio guarda resultados mediante transacciones.

Docker conserva el nombre de proyecto `deploy` y el volumen `deploy_pgdata`. La configuración existente está en `deploy/.env`.

## Recorrido de una práctica

MediaPipe se ejecuta en el navegador y produce puntos de manos y pose y coeficientes faciales. Three.js, Kalidokit y three-vrm animan el avatar. El espejo dibuja los puntos en coordenadas de la cámara y aplica el efecto visual de espejo.

El cliente envía los puntos a POST /api/v1/lsec/practicas. El backend segmenta el gesto, normaliza posiciones por el ancho de hombros y compara trayectorias con DTW. La práctica dirigida compara con el ID elegido. El modo libre ordena hasta tres coincidencias. La configuración de dedos y la orientación se comparan junto con posición y recorrido. La expresión facial interviene cuando una referencia define ese requisito.

El servicio calcula la nota, guarda el resultado en una transacción y responde. Si se pierde la conexión, **Reintentar** reenvía la misma toma y el mismo identificador. Si el intento ya está guardado, el servidor devuelve su resultado aunque el catálogo esté temporalmente fuera de servicio. Salir de la práctica descarta la toma en memoria.

Si la toma supera el tamaño permitido o contiene datos inválidos, la pantalla explica el rechazo y permite grabar otra. Al recuperar la conexión, el navegador actualiza la meta diaria, la racha, los XP y el historial que esté abierto.

El reproductor y el espejo pueden utilizar recursos ya almacenados sin red. El reproductor valida las referencias publicadas antes de guardarlas en el navegador. Si la descarga falla o llega dañada, intenta abrir la última copia válida. Comparar y guardar una práctica necesita el backend accesible. El motor TypeScript permanece como implementación de referencia para paridad y consumidores locales.

## Calificación

La nota de similitud usa 100 × 2^(−distancia/escala) por parámetro y promedia los parámetros aplicables. Las escalas son 0,10 para configuración, 0,35 para orientación, 0,25 para ubicación y recorrido y 0,20 para expresión facial. El ranking divide las distancias por esas escalas antes de promediarlas. Estas escalas son una convención geométrica del piloto.

Los umbrales verde y rojo de una referencia calibrada producen puntaje educativo, zonas de corrección, aprobación y estrellas. Una captura insuficiente tiene nota nula. Las referencias experimentales producen similitud. Las 40 referencias incluidas siguen siendo experimentales.

## Persistencia e identidad

Docker utiliza PostgreSQL 16 con un volumen persistente. El desarrollo local utiliza SQLite en backend/data/visenia.sqlite3 cuando DATABASE_URL está ausente. El esquema se crea al iniciar la API. La tabla schema_migrations registra la versión aplicada. La inicialización de PostgreSQL usa un bloqueo transaccional para coordinar varios procesos.

La tabla practices conserva identificador del intento, hash de la clave del navegador, hash de la solicitud, fecha UTC, tipo de práctica, ID y glosa de referencia, puntaje, resultado y métricas agregadas. El repositorio indexa propietario y fecha. Las solicitudes concurrentes con el mismo ID generan un solo registro. Reutilizar un ID con otro contenido devuelve 409.

Los videos y las coordenadas de participantes permanecen fuera de la base. En los resultados persistidos, frames_ejecucion es un arreglo vacío. El diagnóstico guarda dimensiones, duración y cantidad de cuadros.

Cada navegador genera una clave aleatoria de 256 bits y la conserva en localStorage. La API recibe X-Participant-Key y guarda su hash. Todas las consultas y exportaciones filtran por esa identidad. Borrar los datos del navegador pierde el acceso a ese historial. Quien tenga la clave puede consultar sus resultados. Esta entrega utiliza identidad por navegador y carece de cuentas y recuperación de contraseña. En equipos compartidos, cada perfil del navegador comparte su historial con quienes utilicen ese perfil.

Los JSON y CSV exportados incluyen resultados y métricas. Las exportaciones se entregan por lotes desde la base. La API responde Cache-Control no-store para historial, progreso y exportación.

## Experiencia de práctica

Cada intento guardado con nota suma 10 XP. Una captura insuficiente queda registrada sin sumar puntos. La meta diaria cuenta tres intentos calificados. La racha se calcula con los días consecutivos de práctica en la hora del Ecuador continental. El mapa muestra la mejor nota por seña y el inicio sugiere la próxima seña sin calificación.

El nivel de práctica empieza en 1 y sube cada 100 XP. El reto de vocabulario reconoce la primera seña con nota y los hitos de 5, 10, 20 y 40 señas distintas. Repetir una seña suma experiencia y cuenta una sola vez para el reto. El progreso incluye las prácticas anteriores de ese navegador.

El espejo indica si necesitas centrar el rostro, mostrar ambos hombros o meter una mano completa en la imagen. Comprueba los 21 puntos de cada mano requerida y pide un segundo de encuadre continuo. En las prácticas dirigidas de una mano, la segmentación busca el tramo de la mano que corresponde a la referencia o la alternativa permitida.

El resultado presenta primero el consejo del evaluador. **Ampliar con Groq** envía el modo de práctica, el parámetro que conviene practicar y la observación del evaluador para generar un consejo breve en español. El evaluador local calcula el puntaje y la clasificación. La consulta requiere la credencial del navegador y se reserva por intento para evitar solicitudes simultáneas. El consejo generado se guarda y se reutiliza. Si Groq devuelve un error o se alcanza el límite de uso, se conserva el consejo local y se puede volver a solicitar después de un minuto.

Para activar el coach, guarda una clave de una organización en el plan Free de Groq en `GROQ_API_KEY`, dentro de `deploy/.env`. El backend usa `openai/gpt-oss-20b` mediante la API alojada de Groq. El plan Free aplica límites de solicitudes y tokens a la organización. La clave solo se usa en el backend. [API de Groq](https://console.groq.com/docs/api-reference) · [Límites del plan](https://console.groq.com/docs/rate-limits) · [Facturación](https://console.groq.com/docs/billing-faqs)

Después de guardar la clave, recrea el servicio desde la raíz del proyecto.

```powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d api
```

En desarrollo directo, configura las variables en el entorno de FastAPI.

## Configuración

| Variable | Uso |
| --- | --- |
| DATABASE_URL | Conexión PostgreSQL. Docker la construye con las variables de .env. |
| VISENA_SQLITE_PATH | Ruta SQLite opcional para desarrollo. |
| VISENA_LSEC_DRAFTS | Paquete experimental alternativo. Por defecto utiliza backend/resources/lsec-experimental.json. Una cadena vacía deshabilita los borradores. |
| VISENA_LSEC_CATALOG | Archivo de referencias revisadas. Por defecto backend/data/lsec/catalogo.json. |
| CORS_ORIGINS | Orígenes permitidos, separados por comas. |
| GROQ_API_KEY | Clave opcional de Groq. Para uso gratuito, utiliza una organización en el plan Free. |
| VISENA_API_ORIGIN | Destino del proxy de Vite. Por defecto http://127.0.0.1:8000. |

El despliegue usa el mismo origen HTTPS para front y API. Las peticiones de captura admiten hasta 10 MiB, entre 4 y 300 cuadros y hasta 20 segundos. Las pistas requieren cobertura continua suficiente para obtener una nota.

## Desarrollo local

Desde la raíz del proyecto, prepara las dependencias una vez:

~~~powershell
py -3.14 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
cd frontend
bun install --frozen-lockfile
~~~

En una consola:

~~~powershell
cd C:\Visenia\visenia\backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
~~~

En otra:

~~~powershell
cd C:\Visenia\visenia\frontend
bun run --cwd app dev
~~~

Abre [la aplicación de desarrollo](http://127.0.0.1:5173). La API y el historial usan SQLite salvo que configures PostgreSQL. La documentación interactiva está en /docs y la especificación en /openapi.json.

## Pruebas

~~~powershell
cd C:\Visenia\visenia\backend
.venv/Scripts/python.exe -m ruff check app scripts tests
.venv/Scripts/python.exe -m ruff format --check app scripts tests
.venv/Scripts/python.exe -m pytest -q
cd ../frontend
bun run lint
bun run validate:catalog
bun run test
bun run build
~~~

Los tests verifican contratos, datos insuficientes, correcciones por parámetro, lateralidad, paridad Python/TypeScript, persistencia tras reabrir, aislamiento, paginación, exportación, conflictos y reintentos concurrentes. Los tests de persistencia utilizan bases temporales.

Con el despliegue activo:

~~~powershell
cd C:\Visenia\visenia
$certificadoVisenia = Join-Path $env:TEMP 'visenia-caddy-root.crt'
docker cp visenia-caddy-proxy:/data/caddy/pki/authorities/local/root.crt "$certificadoVisenia"
$env:NODE_EXTRA_CA_CERTS = $certificadoVisenia
bun contracts/typescript/verificar-lote.ts https://localhost
~~~

El ensayo debe reconocer y calificar las 40 referencias al reinyectar sus propios puntos, con coincidencia entre motores. Ese resultado comprueba la integración y necesita complementarse con muestras de otros señantes para medir exactitud.

### Validación con capturas independientes

Para medir el reconocimiento libre, reúne tomas de señantes distintos de quienes aportaron las plantillas o la calibración. Pide a una persona competente en LSEC que etiquete la seña realizada antes de consultar las sugerencias del motor. Cada archivo contiene una toma en formato `Intento` de la API. Usa tomas completas para evaluar también la segmentación automática. Una toma con segmento explícito evalúa el reconocimiento en ese intervalo.

Prepara un manifiesto JSON con rutas relativas al manifiesto. Usa `null` para un movimiento que el catálogo no contiene.

```json
[
  {"archivo": "tomas/hola-01.json", "esperada": "ref-hola"},
  {"archivo": "tomas/fuera-01.json", "esperada": null}
]
```

Desde `backend`, ejecuta el validador con la misma configuración de catálogo que la API.

```powershell
./.venv/Scripts/python.exe -m scripts.validar_reconocimiento ruta/al/manifiesto.json
```

El informe identifica las versiones de motor y catálogo. Calcula la fracción de señas conocidas que aparecen en primera posición y entre las tres sugerencias. El denominador incluye las tomas conocidas que quedaron sin candidatas. También informa los recuentos por seña, las confusiones y cuántas tomas ajenas recibieron una sugerencia. El reconocimiento libre actual propone la coincidencia más cercana cuando hay señales medibles. Conviene leer los resultados de tomas ajenas junto con la exactitud y el número de muestras por seña.

## Referencias nuevas

El paquete experimental incluido permite iniciar el sistema desde este repositorio. Para preparar nuevas muestras, instala backend/requirements-extraction.txt y ejecuta desde backend:

~~~powershell
.venv/Scripts/python.exe -m scripts.prepare_lsec data/references/conadis-lote1/clips data/lsec/borrador-propio.json --version lote-propio-1
~~~

El extractor utiliza los modelos de frontend/app/public/models. Acepta --intervalos archivo.json para corregir segmentos por ID. Consulta la procedencia y las condiciones de uso en [Fuentes](fuentes-lsec.md).

Una referencia publicada necesita anotación completa, revisión de especialista y procedencia. La calibración se registra por parámetro. El contrato de API describe ese formato. Reemplaza paquetes de forma atómica y cambia su versión. Un ID publicado tiene prioridad sobre su borrador.

## Operación y respaldo

~~~powershell
cd C:\Visenia\visenia
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail 80 api
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop
~~~

El comando stop conserva los datos. Para aplicar cambios del backend usa up -d --build. Para cambios de interfaz ejecuta bun run --cwd frontend build y vuelve a abrir las pestañas.

Para respaldar PostgreSQL sin que PowerShell convierta bytes, escribe primero dentro del contenedor y copia el archivo:

~~~powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/visenia-backup.dump'
docker cp visenia-postgres-db:/tmp/visenia-backup.dump ./visenia-backup.dump
~~~

La restauración se realiza con pg_restore en una base elegida para recuperación. Conserva la contraseña de .env, el volumen y los respaldos. Las exportaciones del historial conservan resultados por navegador. Para SQLite, detén la API antes de copiar el archivo de base y sus archivos auxiliares.

## Diagnóstico

/api/health indica que la aplicación está viva. /api/ready comprueba el acceso al esquema persistente y devuelve 503 cuando falla. Un fallo de almacenamiento impide anunciar una práctica como guardada. Los detalles internos de conexión quedan fuera de la respuesta.

Si faltan niveles, comprueba el catálogo y las rutas configuradas. Si una toma carece de calificación, revisa la continuidad de manos y hombros. Una similitud baja requiere revisar la comparación y las referencias. La precisión general del reconocedor, la revisión lingüística y las pruebas con participantes siguen siendo trabajo de validación del producto.
