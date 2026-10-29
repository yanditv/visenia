# Avatar Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir las regresiones del avatar con el catálogo JSON actual.
**Architecture:** Mantener los servicios existentes. Aislar matemáticas de retargeting cuando sea necesario para poder comprobarlas con Node y Three.js sin WebGL.
**Tech Stack:** TypeScript, Three.js, three-vrm, Node test runner; ninguna dependencia nueva.
**Spec:** `docs/superpowers/specs/2026-10-29-avatar-correcciones-design.md`.

## Global Constraints

- Solo local, sin push; rama `codex/correcciones-avatar-sprint-1`.
- Conservar las tres señas del JSON; no exigir 40 referencias ni inventar validación LSEC.
- El usuario pidió ejecutar directamente: no se detiene el trabajo para aprobación de documentos.

## Review Focus

- Pérdida completa/parcial de tracking: reposo abajo, pulgares y expresiones neutros.
- Cruce y detección de una sola mano: asociación por muñecas, sin duplicar lados.
- Profundidad distinta y palmas degeneradas: cuaterniones finitos y muñeca local.
- Overrides sin pose: aplicación exacta y reinicio al cambiar referencia.
- Velocidad, pausa, scrubbing y extremos de segmento: tiempo continuo y aislamiento de modos.

## Archivos e interfaces

`app/src/avatar/vrm-loader-spike.ts`: mantener `updatePose(landmarks)` y corregir aplicación al rig.
`app/src/render/skeleton-renderer.ts`: ampliar landmarks con aspecto de captura y respaldo de configuración cuando aplique.
`app/src/vision/vision-service.ts`: asociación de manos y encuadre.
`app/src/catalogo/catalogo-service.ts`: tiempo, segmentos y datos de demostración.
`app/src/anotador/annotation-service.ts`: exportación temporal fiel.
`app/src/main.ts`, `app/index.html`, `app/src/style.css`: modos, esqueleto compacto y alineación.
`app/tests/*.test.cjs`: pruebas con transpilación de TypeScript usando la dependencia existente.

### Task 1: Retargeting y lateralidad

- [ ] Escribir pruebas de reposo, pulgares, expresiones, overrides exactos, poseWorld, palma 3D, manos cruzadas y encuadre; observar fallos con `npm test --workspace app`.
- [ ] Corregir el solver y la asociación de manos, conservando la firma de los servicios.
- [ ] Ejecutar las pruebas hasta PASS y `npm run build`; commit local de la corrección y pruebas.

### Task 2: Reproducción y captura

- [ ] Añadir pruebas de segmento inicial/final, intervalos irregulares, velocidad, pausa, seek y fps de exportación; observar FAIL.
- [ ] Corregir `selectSena`, `seekFrame`, `setSpeed`, `update` y exportación con timestamps conservados.
- [ ] Ejecutar pruebas hasta PASS y compilación; commit local.

### Task 3: Integración y revisión

- [ ] Probar separación de fuentes y respaldo de las entradas actuales; observar fallos correspondientes antes de corregir.
- [ ] Añadir esqueleto compacto de referencia, alineación video/canvas, cinco parámetros y encuadre adaptable.
- [ ] Ejecutar suite, build y revisión independiente de la rama; corregir hallazgos con pruebas.
- [ ] Registrar resultados y limitaciones en este documento y hacer commit local; no fusionar ni hacer push.

## Registro

- Decisión: trabajar en el checkout actual con rama nueva, atendiendo la instrucción de ejecutar directamente y conservar el entorno local ya instalado.
- Base: `191d929`; auditoría previa conservada.
