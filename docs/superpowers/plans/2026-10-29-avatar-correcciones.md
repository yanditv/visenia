# Avatar Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Corregir las regresiones del avatar con el catálogo JSON actual.
**Architecture:** Mantener los servicios existentes. Aislar matemáticas de retargeting cuando sea necesario para poder comprobarlas con Node y Three.js sin WebGL.
**Tech Stack:** TypeScript, Three.js, three-vrm, Node test runner; ninguna dependencia nueva.
**Spec:** `docs/superpowers/specs/2026-10-29-avatar-correcciones-design.md`.

## Global Constraints

- Solo local, sin push; ramas `fix/S1-avatar-cinematica-y-lateralidad`, `fix/S1-catalogo-tiempo-y-segmentacion` y `fix/S1-integracion-guia-espejo`.
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

- [x] Escribir pruebas de reposo, pulgares, expresiones, overrides exactos, poseWorld, palma 3D, manos cruzadas y encuadre; observar fallos con `npm test --workspace app`.
- [x] Corregir el solver y la asociación de manos, conservando la firma de los servicios.
- [x] Ejecutar las pruebas hasta PASS y `npm run build`; commit local de la corrección y pruebas.

### Task 2: Reproducción y captura

- [x] Añadir pruebas de segmento inicial/final, intervalos irregulares, velocidad, pausa, seek y fps de exportación; observar FAIL.
- [x] Corregir `selectSena`, `seekFrame`, `setSpeed`, `update` y exportación con timestamps conservados.
- [x] Ejecutar pruebas hasta PASS y compilación; commit local.

### Task 3: Integración y revisión

- [x] Probar separación de fuentes y respaldo de las entradas actuales; observar fallos correspondientes antes de corregir.
- [x] Añadir esqueleto compacto de referencia, alineación video/canvas, cinco parámetros y encuadre adaptable.
- [x] Ejecutar suite, build y revisión independiente de la rama; corregir hallazgos con pruebas.
- [x] Registrar resultados y limitaciones en este documento y hacer commit local; no fusionar ni hacer push.

## Registro

- Decisión: trabajar en el checkout actual con rama nueva, atendiendo la instrucción de ejecutar directamente y conservar el entorno local ya instalado.
- Base: `191d929`; auditoría previa conservada.

## Resultado de ejecución

- Tarea 1: commit local e3c427e; 10 pruebas pasan tras reproducir nueve fallos iniciales.
- Tarea 2: commit local 7540c12; siete pruebas nuevas pasan tras reproducir los fallos.
- Tarea 3: integración, 22 pruebas en total, incluyendo la jerarquía real de visenia.vrm.
- Revisión independiente: encontró una incompatibilidad entre la normal de palma y los ejes del VRM; reproducida con el GLB real, corregida y comprobada RED→GREEN. Sin otros hallazgos importantes confirmados.
- Decisión: conservar las ramas históricas y crear ramas fix/S1 apiladas para merges posteriores, según la instrucción posterior del usuario. No se fusiona main ni se hace push.
- Decisión: el JSON original queda intacto. Las cuadrículas se sustituyen solo durante su visualización por una mano abierta de demostración, claramente identificada. Los datos originales no se presentan como referencias lingüísticas validadas.
- Decisión: capturas por debajo de 15 fps se rechazan al exportar con un mensaje explícito, en lugar de falsear la tasa exigida por el schema.
- Verificación visual bloqueada: Computer Use no pudo establecer con certeza la URL del navegador Windows y detuvo la automatización. No se eludió el bloqueo. La cámara real y la fidelidad lingüística permanecen pendientes de validación humana.
- No se amplió catálogo, backend, motor DTW ni flujo de anotación ciega.
