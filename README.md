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
