# ADR-002: Retargeting y Articulación del Avatar 3D VRM

- **Estado:** Aprobado (Revisión v1.1)
- **Fecha:** 2026-10-27
- **Autor:** Desarrollador B (Lucas) / Coordinado con Desarrollador A (Mateo Pacheco)
- **Requerimiento / Contexto:** ERS 8.1 / RF-42 (Sec. 7) / Three.js / @pixiv/three-vrm / Blender

---

## 1. Contexto y Problema

Para la enseñanza interactiva y el catálogo de señas (RF-07, RF-42), el tutor virtual tridimensional debe:
1. Mapear de forma realista las rotaciones de brazos, hombros y columna desde las capturas de MediaPipe.
2. Animar los dedos independientes (21 landmarks por mano) para formar la configuración manual (queirema).
3. Interpretar blendshapes faciales para las expresiones fonológicas (prosoponema).
4. Resolver oclusiones críticas (cuando una mano se cruza frente a otra o tapa los dedos) mediante refinamiento manual asistido por Blender (Sprint 5 / Lote 3).

---

## 2. Decisión

Se consolida la integración entre Three.js, `@pixiv/three-vrm` y los datos maestros de referencia:

### 1. Insumos Cinemáticos Duales:
- El solver cinemático (ej. Kalidokit o motor interno Three.js) consume simultáneamente:
  - `pose_world`: Coordenadas métricas en 3D para resolver la orientación espacial absoluta de huesos claviculares, hombros y codos.
  - `pose`: Coordenadas normalizadas proyectadas para calibrar la perspectiva de la cámara respecto al avatar.
  - `mano_derecha` / `mano_izquierda`: Landmarks de las 21 articulaciones manuales para orientar metacarpianos y falanges.

### 2. Prioridad de Poses Corregidas (`vrm_pose_override`):
- Durante la actualización de cada fotograma en `VrmAvatarViewer`:
  $$\text{Rotación Hueso} = \begin{cases} \mathbf{q}_{\text{override}} & \text{si } \text{bone} \in \text{vrm\_pose\_override} \\ \text{Solver}(\text{pose\_world}, \text{manos}) & \text{en caso contrario} \end{cases}$$
- Esto permite al equipo 3D corregir en Blender señas de contacto estrecho o cruce de manos sin alterar el algoritmo base.

### 3. Expresión Facial Mediante Shape Keys:
- Los valores de `blendshapes_rostro` se aplican directamente sobre `vrm.expressionManager.setValue(nombre, valor)`, permitiendo expresiones continuas y ligeras sin sobrecarga de vértices.

---

## 3. Consecuencias

### Positivas:
- **Flujo Híbrido Robusto:** Total soporte para captura automática con MediaPipe combinada con ajustes finos de artista en Blender (RF-42).
- **Rendimiento Estable:** La cinemática basada en cuaterniones y blendshapes mantiene un costo de cómputo mínimo, asegurando $\ge 60$ FPS en la PWA.
