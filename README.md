# Viseña (VISPROY)

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
├── docs/                 # Decisiones, fuentes LSEC y estado técnico
├── server/               # Backend FastAPI + SQLModel para almacenamiento y exportación (RF-34, RF-37)
└── .github/
    └── workflows/        # Pipelines de Integración Continua (CI)
```

---

## 4. Desarrollo local

Instala Bun en la versión indicada por `packageManager` en `package.json` y Node.js 20, que CI utiliza para ejecutar las pruebas y las herramientas del frontend.

Desde la raíz:

```sh
bun install --frozen-lockfile
bun run --cwd app dev
bun run test
bun run build
bun run format:check
```

### Despliegue local con HTTPS (RNF-14)

Compila primero el frontend con `bun run build`: Caddy sirve `app/dist` y deriva `/api/*`, `/docs*` y `/openapi.json` al backend. Crea `deploy/.env` (ignorado por Git) con `POSTGRES_PASSWORD=` seguido de una contraseña aleatoria propia, larga y segura para URL (letras, números, `_` y `-`). No hay contraseña por defecto. Para un volumen PostgreSQL existente, conserva su contraseña o cámbiala en la base antes de actualizar la configuración.

```sh
docker compose -f deploy/docker-compose.yml config --quiet
docker compose -f deploy/docker-compose.yml up --build -d
```

Abre `https://localhost` y confía en la CA local de Caddy en el equipo de laboratorio. Solo Caddy publica puertos; PostgreSQL y FastAPI son internos. `/api/health` indica que el proceso responde; `/api/ready` ejecuta `SELECT 1` y devuelve 503 si la base no está disponible. La API admite CORS para los orígenes locales declarados en `server/main.py`; `CORS_ORIGINS` permite indicar una lista explícita separada por comas al ejecutar la API fuera de Compose.

Pruebas del backend (Python 3.11 o superior):

```sh
python -m pip install -r server/requirements.txt
python -m unittest discover -s server -v
```

---

## 5. Entrega Frontend-G0

La PWA incluye doce temáticas, tres demostraciones, espejo, avatar VRM y anotación de referencias. El lote LSEC revisado y el motor de evaluación siguen pendientes de integración.

- [Informe técnico consolidado](docs/informes/2026-11-04-estado-tecnico-y-dependencias-programador-a.md)
- [Decisiones de arquitectura](docs/adr)
- [Inventario de fuentes LSEC](docs/datos/lote-1-lsec-conadis-2026-10-30.md)

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
