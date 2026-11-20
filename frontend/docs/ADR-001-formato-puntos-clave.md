# ADR-001: Formato y Normalización de Puntos Clave (MediaPipe Holistic)

## 1. Contexto y Problema

El sistema Viseña requiere capturar y analizar la ejecución de señas por parte del usuario para:

1. Comparación algorítmica multidimensional (DTW) contra señas maestras de referencia.
2. Renderizado de retroalimentación inmediata en el Espejo de Señas (RF-01, RF-02).
3. Resaltado visual selectivo de las zonas anatómicas con desviación fonológica (RF-20).
4. Animación cinemática 3D del Avatar VRM mediante retargeting articular (RF-42).
5. Almacenamiento ético de sesiones con fines de investigación y evaluación de precisión (RF-34).

Por regulaciones éticas de protección de datos personales y requisitos de elegibilidad del fondo **INVENTA**, **está estrictamente prohibido persistir o transmitir secuencias de video en bruto de los participantes** (RF-34).

---

## 2. Decisión

Se adopta una estructura de fotograma unificada (`$defs/FrameCaptura`) compartida entre `data/schemas/referencia.schema.json` y `data/schemas/ejecucion.schema.json`:

### 1. Dualidad `pose` (Canvas 2D) y `pose_world` (Retargeting 3D VRM):

- **`pose` (33 landmarks):** Coordenadas normalizadas en $[0.0, 1.0]$ relativas al marco de la cámara para renderizado sobre el `<canvas>` del Espejo de Señas.
- **`pose_world` (33 landmarks):** Coordenadas tridimensionales métricas reales en metros con origen $(0,0,0)$ centrado en la cadera del usuario. **Indispensables** para que motores de cinemática inversa y retargeting (ej. Kalidokit `Kalidokit.Pose.solve(poseWorldLandmarks, poseLandmarks)` o ThreeVRM) calculen los ángulos reales de hombros, codos y columna sin deformaciones proyectivas.

### 2. Rasgos No Manuales Vía `blendshapes_rostro` (Prosoponema):

- En lugar de guardar los 478 puntos de la malla facial completa (lo que aumentaría el peso del archivo a decenas de megabytes), se registran los **coeficientes de blendshapes** (0.0 a 1.0) correspondientes a los estándares ARKit / MediaPipe FaceLandmarker (`browInnerUp`, `jawOpen`, `eyeBlinkLeft`, etc.).
- Permite la animación directa de los Shape Keys de VRoid y Blender, garantizando a la vez el registro de expresiones faciales en las ejecuciones de investigación (Sprint 4).
- Se conserva un campo opcional `rostro` con un subconjunto mínimo de landmarks solo como fallback técnico.

### 3. Soporte para Corrección de Poses en Blender (`vrm_pose_override` — RF-42):

- Ante oclusiones físicas de manos y cruces de dedos donde la visión computacional degrada su precisión, se habilita el campo opcional `vrm_pose_override`: un diccionario de cuaterniones $[x, y, z, w]$ por articulación exportados desde Blender (Sprint 5 / Lote 3). Si existe, el reproductor VRM prioriza esta rotación precisa.

### 4. Resaltado Visual de Zonas Anatómicas (`zonas_resaltar` — RF-20):

- En `ejecucion.schema.json`, cada parámetro evaluado incluye el arreglo `zonas_resaltar` (`mano_derecha`, `mano_izquierda`, `dedos_mano_derecha`, `antebrazo_izquierdo`, `torso`, `rostro`, etc.), permitiendo que la interfaz HUD del Espejo resalte en rojo o amarillo la parte exacta del cuerpo que falló.

---

## 3. Consecuencias

### Positivas:

- **Compatibilidad Garantizada con VRoid / Three-VRM:** Eliminación de bloqueos cinemáticos para el Sprint 1.
- **Eficiencia de Almacenamiento:** Reducción del tamaño de catálogo y de logs en ~95 % al sustituir la malla de 478 vértices por coeficientes de blendshapes escalares.
- **Trazabilidad y Resaltado (RF-20):** Contrato inequívoco entre la salida del motor de Mateo y la visualización del semáforo/esqueleto en la PWA de Lucas.
