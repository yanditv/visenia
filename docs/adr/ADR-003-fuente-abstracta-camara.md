# ADR-003: Abstracción de Fuente de Video y Señales de Captura

- **Estado:** Aprobado
- **Fecha:** 2026-10-27
- **Autor:** Desarrollador B (Lucas) / Coordinado con Desarrollador A (Mateo Pacheco)
- **Requerimiento / Contexto:** ERS 8.1 / RF-01, RF-02 / RNF-14, RNF-15 / CI Testing

---

## 1. Contexto y Problema

El subsistema "Espejo de Señas" depende del flujo continuo de video proveniente de `navigator.mediaDevices.getUserMedia`. Sin embargo:

1. En servidores de Integración Continua (GitHub Actions) no existen dispositivos de captura física de cámara web.
2. Durante el desarrollo offline o pruebas de estrés del algoritmo DTW se requiere alimentar al sistema con secuencias sintéticas o grabaciones de prueba idénticas y reproducibles.
3. Acoplar la lógica de detección directamente al elemento `<video>` de HTML dificulta el aislamiento en pruebas unitarias y de integración.

---

## 2. Decisión

Se define un patrón de **Fuente Abstracta de Video e Inferencia** (`IVideoFrameProvider` / `ICameraSource`) que desacopla el consumidor (la máquina de estados del espejo y el canvas) del origen de los frames.

### Implementaciones:

1. **`WebcamVideoSource` (Producción / Kiosco):**
   - Consume el stream físico de la webcam mediante `getUserMedia`.
   - Aplica resolución adaptativa ($640 \times 480$ a $30$ FPS estándar; $1280 \times 720$ en hardware con alta capacidad).
   - Maneja excepciones de permisos (`NotAllowedError`), cámara ausente (`NotFoundError`) y contextos inseguros HTTP.
2. **`SyntheticFrameSource` (Testing / CI / Spikes):**
   - Genera secuencias vectoriales y frames cinemáticos matemáticos controlados en tiempo real.
   - Permite simular estados de encuadre válido, señas correctas y gestos erróneos para validar el semáforo de 5 parámetros sin necesidad de intervención humana.
3. **`RecordedJsonlFrameSource` (Validación de Regresión):**
   - Reproduce landmarks guardados en formato JSONL para recalibrar umbrales del motor fonológico de Mateo contra ejecuciones reales históricas.

---

## 3. Consecuencias

### Positivas:

- **CI Totalmente Automatizado:** Los pipelines de GitHub Actions pueden validar la lógica de detección, encuadre y semáforo sin requerir emulación de dispositivos de video.
- **Reproducibilidad:** Facilita la reproducción exacta de bugs reportados con casos de prueba deterministas.
- **Desacoplamiento:** El motor TypeScript (`motor-adapter.ts`) recibe estructuras de datos independientes de si provienen de la webcam o de una prueba sintética.
