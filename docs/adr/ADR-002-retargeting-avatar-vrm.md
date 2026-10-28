# ADR-002: Retargeting y Articulación del Avatar 3D VRM

- **Estado:** Aprobado
- **Fecha:** 2026-10-27
- **Autor:** Desarrollador B (Lucas) / Coordinado con Desarrollador A (Mateo Pacheco)
- **Requerimiento / Contexto:** ERS 8.1 / RF-42 (Sec. 7) / Three.js / @pixiv/three-vrm

---

## 1. Contexto y Problema

Para la enseñanza interactiva y el catálogo de señas (RF-07, RF-42), se requiere un tutor virtual tridimensional capaz de:
1. Articular con alta fidelidad motriz las manos (21 puntos por mano, separación precisa de dedos para el queirema).
2. Reproducir rotaciones fluidas de hombros, codos y muñecas (kinesema y toponema).
3. Mostrar expresiones faciales coherentes (prosoponema).
4. Ejecutarse a $\ge 30$ FPS en navegadores web sin requerir motores pesados de escritorio (Unity o Unreal).

---

## 2. Decisión

Se adopta el formato abierto **VRM (VRM 1.0 / glTF 2.0 extendido para humanoid)** junto con la biblioteca **`@pixiv/three-vrm`** montada sobre **Three.js** en el frontend PWA.

### Elementos Arquitecturales:
1. **Modelo Base (`viseña.vrm`):**
   - Creado en VRoid Studio con topología anatómica adaptada a lengua de señas (malla limpia en falanges y rostro).
2. **Jerarquía de Retargeting Articular:**
   - Mapeo de vectores 3D desde los landmarks normalizados de referencia hacia los nodos de huesos normalizados de VRM (`VRMHumanBoneName`):
     - `RightUpperArm`, `RightLowerArm`, `RightHand`.
     - Falanges de dedos: `RightThumbMetacarpal`, `RightThumbProximal`, `RightThumbDistal`, `RightIndexProximal`, etc.
   - Rotaciones calculadas mediante cuaterniones relativos para evitar bloqueos de cardán (*gimbal lock*).
3. **Blendshapes para Expresión No Manual:**
   - Uso de canales morfológicos VRM (`happy`, `blink`, `neutral`, `aa`) activados de forma sincronizada con las marcas temporales del gesto.
4. **Optimización WebGL:**
   - Limpieza automática de vértices y articulaciones redundantes con `VRMUtils.removeUnnecessaryVertices` y `VRMUtils.deepDispose` al desmontar.

---

## 3. Consecuencias

### Positivas:
- **Portabilidad Web Total:** Renderizado nativo en WebGL dentro de la PWA, compatible con Chrome/Chromium en Windows, Linux y Android (RNF-14).
- **Separación de Responsabilidades:** El modelo 3D estético es intercambiable (ropa, estilo) sin modificar la cinemática de los datos de referencia en JSON.
- **Rendimiento Comprobado:** Spike técnico arrojó $\ge 60$ FPS estables en rendering de Three.js.

### Negativas / Mitigaciones:
- Tamaño de descarga inicial del archivo `.vrm` (~10 a 15 MB). Mitigación: compresión Draco / Meshopt y almacenamiento en caché persistente con Cache Storage / IndexedDB en la PWA.
