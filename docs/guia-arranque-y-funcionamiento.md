# Cómo levantar Viseña y probar el detector LSEC

## Arranque diario en este equipo

Abre Docker Desktop, espera a que el motor de contenedores Linux esté listo y ejecuta en PowerShell:

```powershell
cd C:\Visenia\visenia
docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml up -d
docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml ps
```

Debes ver `caddy` y `api` en ejecución y `db` como `healthy`. Abre la [aplicación](https://localhost) en el mismo equipo. Puedes cerrar PowerShell después del arranque. Si acabas de clonar el repositorio, empieza por [Primera instalación](#primera-instalación-en-windows).

### Probar una seña con la cámara

1. En el mapa, abre **Saludos → HOLA → Iniciar nivel**. Permite el acceso a la cámara cuando el navegador lo solicite.
2. Abre el **espejo** y espera hasta ver que responde a tu movimiento. Encuadra los hombros y las manos durante todo el gesto.
3. Pulsa **Probar seña**, realiza HOLA una vez y pulsa **Terminar toma**. La captura termina automáticamente al llegar a seis segundos.
4. Lee la sugerencia bajo el botón. Por ejemplo, si HOLA es la primera candidata, verás **Sugerencia experimental: HOLA**. Si faltan puntos de seguimiento, repite la toma. Para verificar la instalación independientemente de la cámara, usa la [prueba del lote](#comprobar-el-lote-sin-cámara).

El mapa del piloto ofrece tres demostraciones sintéticas. Desde cualquiera de ellas, **Probar seña** busca coincidencias en todo el lote cargado. Por eso, abrir el nivel HOLA permite recibir otra glosa. Las 40 plantillas experimentales sirven para el reconocimiento libre. Publicar niveles y otorgar puntajes requiere referencias revisadas y, para los puntajes, umbrales calibrados.

## Primera instalación en Windows

Los ejemplos suponen un checkout en `C:\Visenia\visenia`. Si lo guardaste en otra ubicación, adapta la ruta. Necesitas Docker Desktop con Compose y los puertos locales 80 y 443 disponibles. Para compilar la aplicación necesitas Node.js (la CI del frontend usa 20) y Bun (el proyecto declara 1.4.2). Solo necesitas Python 3.14 en Windows si vas a extraer las plantillas, ejecutar las pruebas de Python o desarrollar fuera de Docker.

### 1. Compilar el frontend

```powershell
cd C:\Visenia\visenia\frontend
bun install --frozen-lockfile
bun run build
Test-Path app/dist/index.html
```

El último comando debe devolver `True`. Caddy sirve esa carpeta directamente. La compilación incluye los modelos de pose, manos y rostro, el avatar y los recursos para trabajar sin conexión.

### 2. Preparar las 40 plantillas

Si ya tienes el paquete preparado, colócalo en `backend/data/lsec/borrador-conadis-lote1.json` y pasa al siguiente paso. En una copia nueva de Git encontrarás el inventario y los enlaces de los videos. Los clips y el paquete generado se distribuyen por separado. [Inventario de las 40 señas](../frontend/docs/lote-1-lsec-conadis-2026-10-30.md)

Si partes de los clips, colócalos en `backend/data/references/conadis-lote1/clips/`. Usa como nombre el `video_id` o el `id_propuesto` del inventario, con extensión `.mp4`, `.webm` o `.mov`. Ejecuta en PowerShell:

```powershell
cd C:\Visenia\visenia\backend
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe prepare_lsec.py data/references/conadis-lote1/clips data/lsec/borrador-conadis-lote1.json --version conadis-lote1-piloto-1
```

Si solo tienes los enlaces, instala `yt-dlp` en ese entorno con `.\.venv\Scripts\python.exe -m pip install yt-dlp`, ejecuta `$env:Path = "$(Resolve-Path .venv\Scripts);$env:Path"` en la misma consola y añade `--descargar` al comando de extracción. El resumen debe indicar **40 referencias experimentales preparadas**. Si aparece un número menor, revisa los IDs omitidos en la salida, completa los clips y repite la extracción.

### 3. Configurar y arrancar los servicios

```powershell
cd C:\Visenia\visenia
if (!(Test-Path frontend/deploy/.env)) {
    Copy-Item frontend/deploy/.env.example frontend/deploy/.env
}
notepad frontend/deploy/.env
```

En una instalación nueva, asigna a `POSTGRES_PASSWORD` una contraseña larga de letras y números. En una instalación existente, conserva la contraseña del volumen PostgreSQL. Para activar las plantillas, deja esta línea sin el signo `#` inicial y guarda el archivo. La ruta es la que ve la API **dentro del contenedor**.

```dotenv
VISENA_LSEC_DRAFTS=/workspace/backend/data/lsec/borrador-conadis-lote1.json
```

```powershell
docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml config --quiet
docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml up -d --build
docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml ps
```

### 4. Habilitar HTTPS y comprobar la conexión

Caddy crea una autoridad certificadora para este laboratorio. En el equipo que ejecuta los contenedores, exporta su **certificado público**. Si quieres que Windows y el navegador confíen en esa autoridad local, impórtalo en el almacén de tu usuario:

```powershell
$ca = Join-Path $env:TEMP 'visenia-caddy-root.crt'
docker cp visenia-caddy-proxy:/data/caddy/pki/authorities/local/root.crt "$ca"
Import-Certificate -FilePath $ca -CertStoreLocation Cert:\CurrentUser\Root
```

Vuelve a abrir el navegador. Comprueba primero la conexión con PostgreSQL y después el catálogo, porque son comprobaciones independientes:

```powershell
Invoke-RestMethod https://localhost/api/ready
$catalogo = Invoke-RestMethod https://localhost/api/v1/lsec/catalogo
$catalogo.referencias | Group-Object estado | Select-Object Name, Count
```

Con el piloto completo verás `status = ready`, `database_connected = True` y **40** filas agrupadas bajo `experimental`. Si prefieres probar desde la consola sin instalar el certificado, puedes indicar el archivo exportado directamente a curl con `curl.exe --cacert "$ca" --ssl-revoke-best-effort -fsS https://localhost/api/ready`.

## Cómo funciona el sistema en conjunto

| Componente | Qué hace durante una toma |
| --- | --- |
| Navegador | Carga la aplicación desde Caddy. MediaPipe extrae puntos de pose, manos y rostro a partir de la cámara. El espejo representa el movimiento y recoge una secuencia al pulsar **Probar seña**. El video de la persona permanece en el navegador. |
| Caddy | Sirve el frontend compilado y dirige las peticiones HTTPS de `/api/*` a FastAPI por la red interna de Docker. El navegador usa el mismo origen para ambos. |
| FastAPI | Lee las plantillas JSON del directorio montado. En reconocimiento libre recibe los puntos, localiza el tramo del gesto y compara sus trayectorias con las plantillas mediante DTW, que permite alinear movimientos de distinta duración. Devuelve hasta tres candidatas y el espejo muestra la primera. La comparación se hace en memoria. |
| PostgreSQL | El endpoint `/api/ready` comprueba la conexión mediante una consulta. Las capturas de práctica se procesan sin guardarlas en la base. |

**Reconocimiento libre del piloto.** El espejo envía la secuencia como JSON a `POST /api/v1/lsec/reconocimientos?segmentar=true`. La sugerencia identifica la plantilla más parecida entre las disponibles. Este flujo necesita conexión con el backend local.

**Práctica con una referencia publicada.** El mapa consulta `GET /api/v1/lsec/referencias`. Al practicar una referencia revisada, el cliente obtiene `GET /api/v1/lsec/plantillas/{id_referencia}` y evalúa la toma en el navegador. Si la referencia está calibrada, muestra el puntaje y las correcciones. Una vez cargados los recursos de la aplicación, el catálogo publicado y la plantilla, pueden reutilizarse sin conexión. El piloto actual tiene cero referencias publicadas. [Contrato, esquemas y ejemplos para el frontend](visena-lsec-contract.md)

Para explorar las rutas y sus respuestas, abre la [documentación interactiva de la API](https://localhost/docs). Para consultar qué requisitos están comprobados y cuáles requieren revisión lingüística o pruebas con participantes, consulta el [estado de integración](estado-integracion-frontend.md).

## Comprobar el lote sin cámara

Con los servicios activos y Bun instalado, ejecuta desde la raíz:

```powershell
cd C:\Visenia\visenia
$ca = Join-Path $env:TEMP 'visenia-caddy-root.crt'
docker cp visenia-caddy-proxy:/data/caddy/pki/authorities/local/root.crt "$ca"
$env:NODE_EXTRA_CA_CERTS = $ca
bun frontend-contract/verificar-lote.ts https://localhost
```

El verificador reenvía los puntos de cada referencia por la API y contrasta los motores de Python y TypeScript. En el lote completo se esperan **40 primeras candidatas correctas de 40** y **40 segmentos detectados de 40**. Esta prueba permite detectar errores de integración repetibles. Medir la precisión con señas realizadas por otras personas requiere capturas independientes.

## Detener, actualizar y diagnosticar

Desde la raíz, usa estos comandos según la operación que necesites:

| Operación | Comando de PowerShell |
| --- | --- |
| Detener los servicios conservando datos y certificados | `docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml stop` |
| Volver a encenderlos o aplicar cambios del archivo de entorno | `docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml up -d` |
| Aplicar cambios del código del backend | `docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml up -d --build` |
| Ver los últimos mensajes de los servicios | `docker compose --env-file frontend/deploy/.env -f frontend/deploy/docker-compose.yml logs --tail 80 api db caddy` |
| Aplicar cambios del frontend | `bun run --cwd frontend build` y luego cerrar y volver a abrir la aplicación para cargar la nueva versión. |

| Síntoma | Qué comprobar |
| --- | --- |
| Docker indica que no puede conectarse al motor | Abre Docker Desktop, espera al motor Linux y repite el arranque. Si el error menciona un puerto ocupado, revisa qué servicio está usando 80 o 443. |
| La API responde pero la página da 404 | Comprueba que existe `frontend/app/dist/index.html`. Ejecuta el paso de compilación y entra por [HTTPS local](https://localhost). |
| La página abre pero falta la cámara | Comprueba el certificado, el permiso del sitio y que Windows permite a tu navegador usar la cámara. Espera a ver el movimiento en el espejo antes de iniciar la toma. |
| La toma pide repetir o sugiere otra seña | Comprueba que se vean hombros y manos, que el seguimiento sea fluido y que haya un solo gesto completo. Usa la prueba del lote para comprobar por separado la comunicación y las plantillas. |
| Hay 40 fichas pero aparecen como `pendiente_referencia` | Verifica que existe el JSON extraído, activa `VISENA_LSEC_DRAFTS` en `frontend/deploy/.env` y vuelve a ejecutar `up -d`. El inventario cuenta también las fichas pendientes. |
| La API devuelve `503 catalogo_no_disponible` | Revisa la ruta del JSON dentro del contenedor, el formato del paquete y los logs de `api`. |
| `/api/health` funciona y `/api/ready` devuelve 503 | Revisa el estado de `db`, sus logs y que la contraseña de `.env` corresponda al volumen existente. |

## Desarrollo con recarga local

Para modificar la interfaz sin recompilarla en cada cambio, puedes ejecutar FastAPI y Vite en dos consolas. Usa el entorno de Python y las dependencias del frontend preparados durante la primera instalación.

**Consola 1 · API y lote experimental**

```powershell
cd C:\Visenia\visenia\backend
$env:VISENA_LSEC_DRAFTS = (Resolve-Path data/lsec/borrador-conadis-lote1.json).Path
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Consola 2 · frontend**

```powershell
cd C:\Visenia\visenia\frontend
bun run --cwd app dev
```

Abre la dirección que muestra Vite, normalmente [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite reenvía `/api` al puerto 8000. En este modo, LSEC puede funcionar con una API local sin PostgreSQL. Para que `/api/ready` dé 200, configura `DATABASE_URL` hacia una base accesible desde ese proceso.

Desde `frontend/` puedes ejecutar `bun run lint`, `bun run validate:catalog` y `bun run test`. Desde `backend/`, ejecuta `.\.venv\Scripts\python.exe -m pytest -q` (la CI usa Node.js 24 para las pruebas de paridad). Los scripts de OpenHands y la página de prueba de ASL pertenecen a un prototipo independiente. [Documentación del prototipo ASL](visena-asl-prototype-contract.md)
