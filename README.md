# Viseña (VISPROY)

**Para levantar el proyecto y probar una seña**, sigue la [guía de arranque y funcionamiento](docs/guia-arranque-y-funcionamiento.md). Incluye los comandos de PowerShell para este equipo y para una instalación nueva, la prueba con cámara y el recorrido de los datos entre el navegador, la API y PostgreSQL.

## Backend LSEC para el frontend

En el despliegue local, abre Saludos, inicia el nivel HOLA y pulsa **Probar seña** en el espejo. Las demostraciones habilitan el reconocimiento experimental de las 40 plantillas. El motor de práctica dirigida está preparado para referencias revisadas. [Estado por requisito y pruebas](docs/estado-integracion-frontend.md)

El API integrado usa los puntos de MediaPipe que ya produce el frontend. Expone el catálogo CONADIS, las referencias revisadas para el avatar, el ranking experimental de glosas y la evaluación contra un ID como `ref-hola`. Consulte el [contrato de integración LSEC](docs/visena-lsec-contract.md) y el [cliente TypeScript](frontend-contract/example-lsec-client.ts).

Para probar los clips de referencia, ejecute `prepare_lsec.py` según el contrato LSEC y habilite el paquete experimental con `VISENA_LSEC_DRAFTS`. El paquete revisado se carga desde `backend/data/lsec/catalogo.json`. Los puntajes requieren umbrales calibrados por referencia.

## Backend VISENA en tiempo real

**Práctica ASL con cámara:** `/ws/v2/visena/recognize` usa OpenHands BERT/WLASL2000. La página local ofrece DRINK, HELLO, WATER, EAT, PLEASE, THANK YOU y SORRY, todas glosas del catálogo WLASL2000, con enlaces a demostraciones ASL. Para DRINK informa qué mano se acercó a la boca y señala si se usó la opuesta a la solicitada. El video instructivo no se compara ni se envía al backend. `execution_score` permanece `null` y `execution_score_status` indica `awaiting_validation`: la probabilidad de una clase y las observaciones geométricas no verifican toda la seña. Consulte el [contrato v2](docs/visena-asl-prototype-contract.md), [AsyncAPI v2](docs/asyncapi-asl.yaml), [tipos TypeScript v2](frontend-contract/visena-asl.types.ts) y [evaluación de modelos](docs/model-evaluation.md).

Desde `backend/`, instale `requirements.txt` en `.venv` y `requirements-openhands.txt` en `.venv-openhands`. El checkpoint BERT, las etiquetas WLASL y MediaPipe Holistic se descargan y verifican con `./install_models.ps1` (también lo invocan los scripts de inicio). Para abrir la prueba local **sin clave de Groq**, ejecute `./start_demo.ps1` y visite `http://127.0.0.1:8000/manual-test/camera.html`. Para activar consejos redactados con Groq, ejecute `./start_with_groq.ps1` y escriba la clave cuando se solicite. El script la guarda solo en la variable de entorno del proceso y comprueba el acceso. Puede repetir el diagnóstico con `.\.venv\Scripts\python.exe .\check_groq.py` en una consola que ya tenga `GROQ_API_KEY`. También puede arrancar el API sin la página de prueba usando:

```powershell
# Primera instalación, desde backend/ con Python 3.14 disponible
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
py -3.14 -m venv .venv-openhands
.\.venv-openhands\Scripts\python.exe -m pip install -r requirements-openhands.txt
.\install_models.ps1
.\start_demo.ps1
```

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Si la consola no pega correctamente en la entrada oculta, copie la clave de Groq y ejecute `.\start_with_groq.ps1 -FromClipboard`. Esa opción lee la clave directamente del portapapeles sin mostrarla ni escribirla en archivos. Acepta espacios, comillas y el prefijo `Bearer` al normalizar la entrada.

Salud: `GET http://127.0.0.1:8000/health`. El WebSocket v1 `/ws/v1/visena/evaluate` compara con referencias `.npz` y queda como **legacy/demo**; no representa el flujo deseado basado en modelo. Su [contrato anterior](docs/visena-realtime-contract.md) se conserva por compatibilidad. Los endpoints HTTP que suben videos también son **legacy/deprecated**.

Pruebas desde `backend/`: `.\.venv\Scripts\python.exe -m pytest -q`. BERT/WLASL sigue siendo un clasificador ASL experimental en esta cámara. El backend acepta manos detectadas solo durante la seña. Para `drink`, comprueba la mano que se acercó a la boca y compara con `practice_hand` (`left`, `right` o `either`; por defecto `either`). Si se observó la mano solicitada, BERT recibe el tramo alrededor del gesto sin los puntos de la otra mano. Groq redacta consejos a partir de observaciones agregadas cuando está configurado, incluso si BERT propone otra palabra; el servidor no le permite declarar correcta o incorrecta toda la seña.

La reconstrucción del antiguo LSTM se verifica con logits de la implementación original; su fallo temporal motivó el cambio a BERT. La [evaluación de modelos](docs/model-evaluation.md) muestra qué se comprobó con seis videos de práctica y qué queda por validar. Una predicción distinta de la glosa objetivo no demuestra por sí sola un error del usuario.

### Prueba manual con cámara

Tras ejecutar `./start_demo.ps1` o `./start_with_groq.ps1`, abra `http://127.0.0.1:8000/manual-test/camera.html`. Seleccione una de las siete señas ASL, mire la demostración enlazada, regrese, permita la cámara y pulse **Abrir cámara**. Para cambiar de seña después de conectar, pulse **Cerrar** y seleccione la siguiente. En DRINK se solicita la mano derecha; para las otras seis señas use su mano dominante. Tras conceder el permiso, hay cinco segundos para colocarse en cuadro; la captura dura 5,5 segundos y termina automáticamente. Mantenga la pestaña visible: ocultarla cancela la toma, y una cámara que envía menos de 16 imágenes también requiere reintentar. El resultado principal muestra la sugerencia experimental del modelo y qué observar en la demostración. La puntuación de ejecución queda pendiente de validación. Porcentajes y detalles de servicios quedan en apartados desplegables. La página solo está disponible cuando `VISENA_ENABLE_MANUAL_TEST=1`. Pruebas del flujo de captura: `node --test backend/tests/manual_camera.test.cjs` desde la raíz.

> **Plataforma Educativa y de Práctica Asistida de Lengua de Señas con Espejo Digital y Avatar 3D**  
---

## 1. Convención y Flujo de Trabajo (Git Workflow)

Conforme a la sección 8.1 del ERS:

1. **Rama Base:** `main` permanece siempre funcional, estable y desplegable en producción.
2. **Ciclo de Ramas:** Feature Branching corto con GitHub Flow.
3. **Políticas de Integración:**
   - Ningún commit directo a `main`.
   - Pull Request (PR) obligatorio con:
     - Revisión cruzada aprobada por el Desarrollador A (Mateo Pacheco).
     - CI verde (linters, formato y pruebas unitarias/integración pasando).
4. **Trazabilidad INVENTA:**
   - Todo commit y nombre de rama debe referenciar explícitamente el requerimiento asociado:
     - `RF-xx`: Requerimiento Funcional
     - `RNF-xx`: Requerimiento No Funcional
     - `ADR-xxx`: Architectural Decision Record
5. **Nomenclatura de Ramas:**
   - `feat/RF-<numero>-<descripcion-corta>` (Funcionalidades)
   - `chore/<descripcion-corta>` (Infraestructura / configuración)
   - `spike/<descripcion-corta>` (Investigación / prototipos técnicos)
   - `docs/<descripcion-corta>` (Documentación / ADR / Manuales)
   - `fix/<descripcion-corta>` (Corrección de errores)

---

## 3. Estructura del Monorepo

```text
visenia/
├── backend/              # FastAPI, extracción y evaluación LSEC
├── docs/                 # Contratos del backend y evaluación de modelos
├── frontend-contract/    # Tipos y ejemplos de consumo
├── frontend/
│   ├── app/              # PWA Vite, MediaPipe y Three.js/VRM
│   ├── data/schemas/     # Contratos de referencia y ejecución
│   ├── deploy/           # Caddy, FastAPI y PostgreSQL
│   └── docs/             # ADR, informe técnico e inventario de fuentes LSEC
└── .github/
    └── workflows/        # Pipelines de Integración Continua (CI)
```

---

## 4. Desarrollo local

Instala Bun en la versión indicada por `packageManager` en `package.json` y Node.js 20, que CI utiliza para ejecutar las pruebas y las herramientas del frontend.

Desde `frontend/`:

```sh
bun install --frozen-lockfile
bun run --cwd app dev
bun run lint
bun run validate:catalog
bun run test
bun run build
bun run format:check
```

### Despliegue local con HTTPS (RNF-14)

Compila primero el frontend con `bun run build`. Caddy sirve `frontend/app/dist` y deriva el API de laboratorio, las rutas LSEC y OpenAPI al backend. Desde `frontend/`, crea `deploy/.env` (ignorado por Git) con `POSTGRES_PASSWORD=` seguido de una contraseña aleatoria propia, larga y segura para URL (letras, números, `_` y `-`). Para un volumen PostgreSQL existente, conserva su contraseña o cámbiala en la base antes de actualizar la configuración.

```sh
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build -d
```

Abre `https://localhost` y confía en la CA local de Caddy en el equipo de laboratorio. Solo Caddy publica puertos. `/api/health` indica que el proceso responde. `/api/ready` ejecuta `SELECT 1` y devuelve 503 si la base está indisponible. `CORS_ORIGINS` permite indicar los orígenes de desarrollo separados por comas al ejecutar la API fuera de Compose.

Pruebas desde `backend/` (Python 3.14):

```sh
python -m pip install -r requirements.txt
python -m pytest -q
```

---

## 5. Entrega histórica Frontend-G0

Estado al **10 de noviembre de 2026**, rama `Frontend-G0`, commit `3ba8621`:

- Doce temáticas con mapa de niveles; la cámara, MediaPipe y el avatar se inician al comenzar un nivel disponible. Los niveles sin referencias permanecen inhabilitados.
- Tres demostraciones sintéticas: HOLA en Saludos; GRACIAS y POR FAVOR en Cortesía. Reproductor con segmentos, pausa, desplazamiento y velocidades 1×/0,5×; modos guía y espejo separados.
- Anotador con campos fonológicos, expresión facial explícita cuando se requiere y validación antes de exportar referencias.
- Interfaz es-EC, fuentes locales, tamaño de texto, contraste alto y preferencia de mano almacenados localmente. La preferencia de mano no acredita adaptación del motor para zurdos.
- WASM local y service worker generado con el inventario del build. La sesión offline requiere una carga inicial con red y la instalación completa del caché; pendiente la comprobación física en laboratorio.
- API con `/api/health`, `/api/ready` y `/api/version`; Caddy sirve el frontend compilado y solo el proxy expone puertos.

**Verificación local:** 54 pruebas aprobadas, tipos/sintaxis, formato, catálogo y build correctos; configuración Compose válida usando una contraseña de prueba. El bundle principal es de 881,31 kB (gzip 232,26 kB), con aviso de tamaño de Vite. Las pruebas del backend no pudieron ejecutarse por falta de Python utilizable. No se acredita CI remota, despliegue completo ni rendimiento de cámara con estas comprobaciones.

**Pendientes:** integrar cuarenta referencias reales revisadas por especialista y el motor de evaluación. El inventario documental de cuarenta fuentes no equivale a cuarenta secuencias utilizables. La persistencia y exportación de ejecuciones tampoco están implementadas en la API actual.

### Revisión de contratos 

Los esquemas [referencia](frontend/data/schemas/referencia.schema.json) y [ejecución](frontend/data/schemas/ejecucion.schema.json) usan la versión `1.1.0`. El API usa los campos obligatorios de los esquemas actuales y valida la fecha de anotación con hora y zona para publicar. `bun run validate:catalog` comprueba el catálogo estático de referencia del frontend.

- [Informe técnico consolidado](frontend/docs/InformeTecnico.md)
- [Decisiones de arquitectura](frontend/docs)
- [Inventario de fuentes LSEC](frontend/docs/lote-1-lsec-conadis-2026-10-30.md)

## 6. Hoja de Ruta de Sprints y Puertas de Control

| Fase         | Período         | Puerta de Control / Hito                                                  |
| :----------- | :-------------- | :------------------------------------------------------------------------ |
| **Semana 0** | 26 oct – 1 nov  | Monorepo verificado, contratos de datos unificados e infraestructura base |
| **Sprint 1** | 2 nov – 15 nov  | **G1:** 40 referencias anotadas y catálogo con reproductor                |
| **Sprint 2** | 16 nov – 29 nov | **G2:** Una seña practicada de inicio a fin con veredicto ≤ 300 ms        |
| **Sprint 3** | 30 nov – 13 dic | **G3:** 4 unidades temáticas jugables con semáforo y gamificación         |
| **Sprint 4** | 14 dic – 27 dic | **G4:** Exactitud ≥ 75 % en piloto (~300 ejecuciones) y server API        |
| **Sprint 5** | 28 dic – 10 ene | **G5:** 120 señas jugables y modo kiosco estable durante 8 horas          |
| **Sprint 6** | 11 ene – 24 ene | **G6:** Entrega v1.0, auditoría RNF-14/17 y manuales oficiales            |
