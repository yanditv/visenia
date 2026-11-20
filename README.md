# Viseña (VISPROY)

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
> Proyecto financiado por el fondo **INVENTA** y sujeto a declaración de invención y trazabilidad de requerimientos.

---

## 1. Equipo y Roles Técnicos

- **Desarrollador A:** Mateo Pacheco — Motor TypeScript/Python fonológico, segmentación de señales (`encuadre_valido`, `inicio_sena`, `fin_sena`), algoritmos DTW y extracción de parámetros.
- **Desarrollador B:** Lucas — PWA Espejo de Señas, Avatar 3D VRM (Three.js/three-vrm), pipelines de infraestructura local/laboratorio (Caddy/Docker), sincronización y herramientas de anotación.

---

## 2. Convención y Flujo de Trabajo (Git Workflow)

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
├── app/                  # PWA Frontend (Vite + TypeScript + MediaPipe Holistic + Three.js/VRM)
├── data/
│   └── schemas/          # JSON Schemas maestros: referencia y ejecución (ERS 6.1, 6.2)
├── deploy/               # Caddy (HTTPS local), FastAPI y PostgreSQL (Docker Compose ERS 3.4)
├── docs/                 # ADRs arquitecturales (ERS 8.1) y manuales v1.0 (ERS 8.4)
│   ├── adr/
│   └── manuales/
├── server/               # Backend FastAPI + SQLModel para almacenamiento y exportación (RF-34, RF-37)
└── .github/
    └── workflows/        # Pipelines de Integración Continua (CI)
```

---

## 4. Hoja de Ruta de Sprints y Puertas de Control

| Fase | Período | Puerta de Control / Hito |
| :--- | :--- | :--- |
| **Semana 0** | 26 oct – 1 nov | Monorepo verificado, contratos de datos unificados e infraestructura base |
| **Sprint 1** | 2 nov – 15 nov | **G1:** 40 referencias anotadas y catálogo con reproductor |
| **Sprint 2** | 16 nov – 29 nov | **G2:** Una seña practicada de inicio a fin con veredicto ≤ 300 ms |
| **Sprint 3** | 30 nov – 13 dic | **G3:** 4 unidades temáticas jugables con semáforo y gamificación |
| **Sprint 4** | 14 dic – 27 dic | **G4:** Exactitud ≥ 75 % en piloto (~300 ejecuciones) y server API |
| **Sprint 5** | 28 dic – 10 ene | **G5:** 120 señas jugables y modo kiosco estable durante 8 horas |
| **Sprint 6** | 11 ene – 24 ene | **G6:** Entrega v1.0, auditoría RNF-14/17 y manuales oficiales |
