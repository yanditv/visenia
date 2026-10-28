# ADR-001: Formato y Normalización de Puntos Clave (MediaPipe Holistic)

- **Estado:** Aprobado
- **Fecha:** 2026-10-27
- **Autor:** Desarrollador B (Lucas) / Revisado con Desarrollador A (Mateo Pacheco)
- **Requerimiento / Contexto:** ERS 6.1, 6.2, 8.1 / RF-01, RF-34 / Fondo INVENTA

---

## 1. Contexto y Problema

El sistema Viseña requiere capturar y analizar la ejecución de señas por parte del usuario para:
1. Comparación algorítmica multidimensional (DTW) contra señas maestras de referencia.
2. Renderizado de retroalimentación inmediata en el Espejo de Señas.
3. Almacenamiento de sesiones con fines de investigación y evaluación de precisión.

Por regulaciones éticas de protección de datos personales y requisitos de elegibilidad del fondo **INVENTA**, **está estrictamente prohibido persistir o transmitir secuencias de video en bruto de los participantes** (RF-34). Además, la transmisión o almacenamiento de video generaría una sobrecarga inadmisible en redes locales y dispositivos móviles.

---

## 2. Decisión

Se decide adoptar como estándar de serialización de movimiento corporal los **puntos clave (landmarks) 3D normalizados de MediaPipe Holistic**, estructurados bajo los esquemas JSON maestros definidos en `data/schemas/referencia.schema.json` y `data/schemas/ejecucion.schema.json`.

### Reglas de Normalización:
1. **Espacio de Coordenadas:**
   - Coordenadas `x` e `y` normalizadas en el intervalo $[0.0, 1.0]$ relativas al marco visual de la cámara.
   - Coordenada `z` relativa a la profundidad del plano del torso (mid-hip / mid-shoulder).
2. **Subconjunto Filtrado de Landmarks:**
   - **Pose (Torso/Brazos):** 8 puntos clave esenciales (hombros [11, 12], codos [13, 14], muñecas [15, 16] y base de cuello/nariz [0]). Se descartan miembros inferiores para optimizar memoria.
   - **Manos (Izquierda y Derecha):** 21 landmarks por mano (estructura carpo-metacarpo-falanges completa).
   - **Rostro:** Puntos seleccionados de contorno peribucal y cejas para el parámetro prosoponémico (expresión no manual).
3. **Privacidad por Diseño:**
   - Únicamente se almacenan tuplas numéricas $(x, y, z, \text{visibility})$ y marcas de tiempo $(\text{timestamp\_ms})$. El stream de video de píxeles se descarta inmediatamente tras la inferencia en memoria.

---

## 3. Consecuencias

### Positivas:
- **Garantía Ética y Legal:** Cumplimiento total con los lineamientos del fondo INVENTA sobre anonimización y privacidad de participantes.
- **Eficiencia de Almacenamiento:** Reducción de más del 98 % del volumen de datos en comparación con archivos de video comprimidos (un gesto de 3 segundos ocupa ~45 KB en JSON/Parquet vs. ~3-8 MB en MP4).
- **Consumo Directo:** Entrada inmediata para el motor fonológico de Mateo (distancias euclidianas, ángulos de articulación y DTW) y para el retargeting del avatar VRM.

### Negativas / Mitigaciones:
- Dependencia de la precisión del modelo Holistic Landmarker ante oclusiones severas. Mitigación: umbral de confianza mínimo ($\ge 0.5$) y alerta de baja calidad visual (RF-06).
