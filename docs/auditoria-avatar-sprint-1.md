# Auditoría local del Sprint 1: avatar, referencias e integración

Fecha: 29 de octubre de 2026. Estado auditado: `main`, commit `191d9296af975fdf54eaea377c9dc528725d7fa5`.

## Dictamen

El repositorio contiene una base técnica que compila, pero el informe **no acredita un avatar pedagógicamente correcto ni el cierre de G1**. Hay fallos reproducibles en las referencias, la relación entre captura y avatar, las poses de reposo y las correcciones manuales. Varias soluciones históricas fueron sustituidas por implementaciones con limitaciones nuevas.

Se revisaron el informe solicitado en `.gemini/antigravity/brain/4ca72c7a-06d9-4332-a758-0d3f21574bd9/resumen-sprint-1.md`, su copia idéntica en `docs/resumen-sprint-1.md`, la ERS de Downloads, las ramas, los diffs y el código actual. No se modificó código funcional, no se cambiaron ramas ni se realizaron pushes o consultas al remoto. Las referencias `origin/*` son las disponibles localmente; no equivalen a una consulta actual de GitHub.

## Trazabilidad de ramas y commits

- Los 11 cambios del Sprint 1 están integrados en `main`: 11 commits de trabajo y 11 merges entre `add9c3c` y `68d4562`. `191d929` añade el informe.
- Las ramas del Sprint 1 no contienen una corrección posterior pendiente de integrar. Volver a fusionarlas no resuelve los fallos actuales.
- `main` está 42 commits por delante de la referencia local `origin/main` y cero por detrás.
- `git branch --no-merged main` muestra `chore/s0-monorepo-ci-config` y `feat/s0-data-schemas-contratos`. Contienen commits adicionales a la línea integrada; su existencia no prueba que falten por completo los schemas o la CI, que sí están en `main`.
- Los textos «Merge pull request #10…#20» son mensajes de commits locales. Por sí solos no demuestran PR publicados ni revisiones de otra persona.

| Cambio | Efecto que permanece en HEAD | Limitación actual |
| --- | --- | --- |
| `297d8fd` / `63ef52a` | Inicialización con `Promise.allSettled` | Se exige Pose y Manos; únicamente el rostro puede fallar sin bloquear el servicio. |
| `9174e70` / `75d4d3c` | Sustitución de modelos y adición de iconos | La compilación no demuestra inferencia GPU correcta ni fps de cámara. |
| `723e106` / `2ac6fae` | Orientación base y nueva cámara | El encuadre es fijo y no asegura espacio para las manos en todas las relaciones de aspecto. |
| `4ab5b26` / `6fa482f` | Adaptación para Kalidokit | El solver y ese adaptador fueron sustituidos en `51f3689`. |
| `3726913` / `97a7777` | Uniones codo–mano y asignación lateral | La asignación por X sigue fallando con manos cruzadas y etiquetas duplicadas. |
| `51f3689` / `a608268` | Modos Guía/Espejo y cinemática propia | Se abandona `pose_world`; aparecen fallos de reposo y se simplifican muñecas/dedos. |
| `e4e9670` / `68d4562` | Limpieza de textos y retirada del HUD | Desaparece la referencia esquelética sin un reemplazo para RF-08. |

## Hallazgos prioritarios

### 1. P1 — El catálogo utiliza manos sintéticas inválidas como referencia anatómica

Origen: `61b1407`, rama `feat/S1-RF07-RF08-catalogo-reproductor`. Archivo: `app/public/data/referencias-v1.json`.

Las tres entradas —HOLA, GRACIAS y POR FAVOR— contienen 133 cuadros en total. En **133/133** se cumple exactamente esta construcción de la mano, para cada índice `i`:

```text
x[i] = x[0] + (i % 5) * 0.015
y[i] = y[0] + floor(i / 5) * 0.02
z[i] = z[0]
```

Es una cuadrícula de puntos, no la topología anatómica de los 21 landmarks. Las tres señas comparten esa geometría rígida. Además, la muñeca de las tres recorre una recta: `y - 0.3 = 0.5 * (x - 0.65)` con error numérico menor a `3e-17`. POR FAVOR está etiquetada como circular, pero sus puntos no describen un círculo.

También se comprobó que todo `pose_world` es una transformación algebraica de `pose`: `xw=(x-0.5)*1.4`, `yw=(0.5-y)*1.4`, `zw=z`. No son capturas métricas independientes. No basta conectar nuevamente `pose_world` sin reemplazar estos datos.

Consecuencia: ni una animación fluida ni la retirada del zigzag prueban que el avatar enseñe estas señas correctamente. Deben identificarse como datos de demostración y reemplazarse por referencias capturadas y validadas por el especialista. No se puede acreditar RF-42 con ellas.

### 2. P1 — La pose de reposo eleva ambos brazos

Regresión en `51f3689`. Archivo: `app/src/avatar/vrm-loader-spike.ts:190`, `:225`, `:259` y `:430`.

Se asignan rotaciones Z de `-1.32` al brazo derecho y `+1.32` al izquierdo. Los propios ejes T-pose usados por el algoritmo son derecho `(-1,0,0)` e izquierdo `(1,0,0)`. Las transformaciones producen aproximadamente:

```text
derecho = (-0.248, +0.969, 0)
izquierdo = (+0.248, +0.969, 0)
```

Ambos apuntan hacia arriba. La inspección de la jerarquía del VRM real confirmó las direcciones iniciales derecha ≈ `-X` e izquierda ≈ `+X`; no es solo una suposición de un modelo ficticio. Al perder tracking, el destino de la interpolación es incorrecto. Revisar los signos con una pose neutral verificada sobre el rig real.

### 3. P1 — Los brazos mezclan espacios de coordenadas y descartan el 3D métrico

Regresión en `51f3689`. Archivo: `app/src/avatar/vrm-loader-spike.ts:189–253`.

El solver solo lee `landmarks.pose`; `poseWorld` no participa. Una prueba que alteró fuertemente todos los puntos de `poseWorld` manteniendo `pose` produjo exactamente la misma orientación del brazo. Esto contradice los insumos duales acordados en ADR-002.

Además, se resta `wrist.z` de HandLandmarker a `pose[13/14].z`. Son resultados de detectores distintos y el código no establece un origen y escala comunes. Tampoco corrige la distinta escala horizontal/vertical de las coordenadas normalizadas para una imagen que no sea cuadrada. Invertir signos no resuelve estas incompatibilidades.

Consecuencia: profundidad y orientación del antebrazo pueden ser incorrectas aunque el resultado 2D parezca razonable. Establecer una conversión común y validada antes de calcular vectores y cuaterniones.

### 4. P1 — La asignación lateral sigue intercambiando manos cuando se cruzan

Persistente desde `3726913`. Archivos: `app/src/vision/vision-service.ts:190–229`, `app/src/render/skeleton-renderer.ts:112–132` y `app/src/avatar/vrm-loader-spike.ts:210`, `:244`.

Se invierten siempre las etiquetas `Left/Right`. El valor `score` se obtiene, pero no se usa. Cuando ambas manos reciben la misma etiqueta, se ordenan por X en lugar de asociarlas a las muñecas de Pose o mantener continuidad temporal.

Reproducción con detectores simulados: muñeca derecha de Pose en `x=0.8`, izquierda en `x=0.2`, y dos manos cruzadas con etiqueta duplicada. El servicio entrega derecha en `0.2` e izquierda en `0.8`. El renderer conecta después esas manos a los codos equivocados. Por eso no se sostiene la afirmación de haber erradicado completamente las líneas cruzadas.

La inversión global de etiquetas requiere además una prueba real de lateralidad del flujo de captura. Esta auditoría demuestra el fallo del desempate; no certifica que todas las etiquetas de una webcam real estén invertidas.

### 5. P1 — Muñecas y dedos no reconstruyen la orientación/configuración 3D completa

Regresión/simplificación en `51f3689`. Archivo: `app/src/avatar/vrm-loader-spike.ts:311–379`.

- La normal de palma se construye con dos vectores a los que se fija `z=0`. Su normal normalizada solo puede aportar el signo de Z, y el giro Y se reduce esencialmente a dos valores `±0.4`, salvo degeneraciones.
- La rotación de muñeca se calcula desde direcciones de imagen y se aplica directamente como rotación local, sin descontar la orientación acumulada del antebrazo.
- El curl usa distancias XY de punta y nudillo a muñeca. No calcula ángulos de las falanges en 3D, separación entre dedos ni oposición completa del pulgar.
- La misma rotación se aplica a las tres falanges de cada dedo y no se anima el metacarpiano del pulgar.

Cambiar exclusivamente la profundidad de todos los landmarks dejó las componentes de los cuaterniones de muñeca/dedo sin cambios relevantes. El solver diferencia algunas aperturas/cierres, pero no acredita queirema y orientación fieles para LSEC. Validar con poses conocidas y contactos reales, no con las cuadrículas del catálogo.

### 6. P1 — `vrm_pose_override` no tiene la prioridad absoluta declarada

Archivo: `app/src/avatar/vrm-loader-spike.ts:154–164` y `:295–302`.

Primero se aplica el solver y después un `slerp(override, 0.8)`. En el siguiente cuadro el solver vuelve a apartar el hueso del objetivo. Una prueba repetida de 100 actualizaciones con un override fijo en `leftUpperArm` conservó **15.65° de error** respecto a la corrección solicitada.

Además, si un cuadro contiene solo overrides y no contiene Pose o manos, `hasLiveInput` lo deriva a reposo y ni siquiera se ejecutan los overrides. Las correcciones de Blender no son fiables bajo el contrato actual. El hueso corregido debe respetar el objetivo y los cuadros con solo correcciones deben poder reproducirse.

### 7. P1 — Se retiró el esqueleto de referencia requerido por RF-08

Regresión en `e4e9670`. Archivos: `app/index.html` y `app/src/main.ts`.

Se eliminó `avatar-hand-canvas` y su renderizador sin reemplazarlo. El único canvas esquelético restante representa al usuario; no muestra la referencia del catálogo. RF-07 pide referencia en avatar y esqueleto, RF-08 exige esqueleto superpuesto y la ERS prevé usarlo cuando el avatar no reproduce una seña con fidelidad.

Retirar un overlay mal dimensionado resuelve la obstrucción visual, pero deja pendiente una función exigida y el recurso de respaldo para señas no validadas.

### 8. P2 — Persisten estados de pulgares y expresiones de cuadros anteriores

Archivo: `app/src/avatar/vrm-loader-spike.ts:277–293`, `:386–405`.

`relaxFingers` no incluye los huesos del pulgar. Después de 80 relajaciones, un pulgar flexionado conservó su cuaternión. Las expresiones solo se escriben si llega la clave: un cuadro con `jawOpen=1` seguido de un cuadro sin blendshapes mantuvo `aa=1`.

Consecuencia: al perder una mano o cambiar de referencia pueden quedar pulgares doblados y expresiones residuales. Hace falta neutralización explícita de estados ausentes y al cambiar de fuente.

### 9. P2 — La captura, la segmentación y la reproducción no conservan el mismo tiempo

Origen: `f90e6f8` y `61b1407`. Archivos: `app/src/anotador/annotation-service.ts:173–180`, `:200–204`, `:229`; `app/src/catalogo/catalogo-service.ts:54–59`, `:122–139`.

El anotador exporta todos los cuadros y guarda solo los índices de recorte. El reproductor ignora esos índices y reproduce desde cero hasta el último cuadro. Se comprobó que HOLA inicia en 0 aunque su segmento empiece en 5.

El reproductor también ignora `timestamp_ms` y avanza a un fps global. El anotador fuerza ese fps a un mínimo de 15: una captura más lenta se reproduce acelerada; los intervalos irregulares se convierten en pasos uniformes. El informe habla de interpolación temporal entre cuadros, pero la implementación selecciona un cuadro entero; el suavizado óseo no sustituye esa interpolación.

### 10. P2 — El esqueleto y la imagen de cámara pueden quedar desalineados

Archivo: `app/src/style.css:163–182` y `app/src/main.ts:195–202`.

El video usa `object-fit: cover`, que recorta la imagen según el contenedor. El canvas estira el frame completo a ese contenedor sin aplicar el mismo recorte. Cuando las relaciones de aspecto difieren, los puntos no coinciden con las articulaciones visibles. Este fallo es independiente de la inversión espejo y de la clasificación de manos.

### 11. P2 — El encuadre válido no comprueba el criterio de práctica

Archivo: `app/src/vision/vision-service.ts:166–176`; `app/src/main.ts:225–234`, `:367–379`.

Se comprueban posiciones de nariz y hombros, pero no ambas manos, rostro detectado, visibilidad suficiente ni estabilidad durante un segundo. La reproducción con detectores simulados pudo marcar válido sin un detector facial activo. Se permite iniciar grabación solo por tener cámara/simulación activa. RF-03 sigue parcial; su integración pertenece al Sprint 2 según la ERS, por lo que no debe confundirse con una regresión exclusiva del Sprint 1.

## Brechas frente a la ERS y al informe

1. **No se acredita G1.** La ERS fija Sprint 1 del 2 al 15 de noviembre y exige 40 referencias anotadas y cargadas. El informe llama Sprint 1 al 27–29 de octubre y el catálogo tiene tres entradas sintéticas. Puede ser avance anticipado, pero no cierre de la puerta de control. Las 120 referencias son el objetivo posterior de G5, no una obligación de este hito temprano.
2. **RF-42 está parcial.** No hay retargeting activo de cabeza en la cinemática directa; el cuello solo recibe una pequeña oscilación en reposo. El rostro traduce parpadeos, apertura mandibular y sonrisa, sin un mapeo completo de los componentes no manuales ni evidencia del reconocimiento por especialista en al menos 90 % de las referencias.
3. **RF-07 está parcial.** Además del volumen de referencias, la ficha muestra tres parámetros (`main.ts:110–117`), no los cinco exigidos. RF-10 tiene carga por archivo externo, pero el JSON se acepta sin validación del contrato en ejecución.
4. **RF-36 no equivale todavía a anotación ciega.** Hay captura de referencias y formulario, pero no revisión ciega de ejecuciones ni medición de los 30 segundos. La orientación exportada está fijada en `[0,1,0]` (`main.ts:440`), sin un control para anotar la orientación real. El deslizador guarda índices pero no ofrece reproducción del tramo capturado.
5. **Guía/Espejo se separan en el bucle principal, con una excepción.** El handler del scrubber llama a `avatarViewer.updatePose` sin comprobar el modo (`main.ts:152–160`). También se aplica la misma política de reflejo en el viewer a referencias canónicas y captura en vivo: no existe una política explícita de lateralidad/normalización de referencias y mano dominante. Debe definirse y probarse; no se concluye que todo reflejo pedagógico sea incorrecto.
6. **El prototipo completo sigue pendiente.** No existe `motor/` en este checkout y `server/main.py` solo expone salud. Evaluación DTW, veredictos, retroalimentación y persistencia no quedan demostrados por este sprint; la ERS los distribuye en hitos posteriores. No son todos defectos que hubiera que resolver en Sprint 1.
7. **La verificación declarada es insuficiente para fidelidad.** La CI comprueba sintaxis JSON, no conformidad de cada referencia con el schema. No hay script de pruebas en `app/package.json`; `--if-present` permite que el paso de pruebas termine sin ejecutar pruebas del avatar. Compilar no valida lateralidad, contactos, reconocimiento de señas ni fps reales.
8. **PWA offline incompleta.** Se intenta registrar `/sw.js` en HTTPS (`main.ts:457`), pero ese archivo no aparece en los archivos del repositorio ni se genera mediante un plugin en esta compilación. WASM se solicita además a un CDN. El modo sin red requiere verificación adicional.
9. **El VRM real es versión 1.0.** El binario contiene `extensions.VRMC_vrm.specVersion = "1.0"`. La explicación histórica del informe que alude a VRM 0.0 no describe el modelo actual y no debe usarse para decidir nuevas inversiones.

## Verificación realizada y límites

- `npm run build`: pasa TypeScript y Vite; emite advertencia de chunk de aproximadamente 853 kB. Es una comprobación de compilación, no una medición de ejecución.
- Pruebas locales mediante transpilación de las clases TypeScript actuales: se invocaron métodos de cinemática con Three.js real y nodos simulados para aislar reposo, overrides, profundidad, pulgares y expresiones. No se instanció un renderer WebGL.
- Inspección binaria del GLB/VRM y cálculo de transformaciones de su jerarquía: confirma VRM 1.0 y ejes de brazos.
- Prueba de `VisionService.detect` con resultados simulados: reproduce intercambio lateral con manos cruzadas/etiquetas duplicadas. No sustituye un ensayo con webcam.
- Inspección programática completa de las 133 manos, las trayectorias y la fórmula de `pose_world`.
- No se probó cámara real, reconocimiento por especialista, Jetson, GPU en navegador ni la disponibilidad actual del remoto. Las afirmaciones visuales del informe no quedan revalidadas por este análisis.

## Orden recomendado de corrección

1. Identificar claramente las referencias de demostración y preparar un pequeño conjunto real validado, con lateralidad, profundidad y poses conocidas.
2. Definir un contrato único de coordenadas desde detectores/referencias al rig; corregir reposo y asociación de manos a muñecas de Pose.
3. Corregir muñecas/dedos, prioridad de overrides y neutralización de estados; comprobar cada resultado en el VRM real.
4. Recuperar el esqueleto de referencia y el respaldo para señas que no superen la revisión del especialista.
5. Conservar tiempos y segmentos de captura/reproducción; alinear video y canvas y completar la herramienta de anotación.
6. Ejecutar una matriz real: cada mano por separado, brazos arriba/abajo, manos cruzadas, palma/dorso, pinza, puño, pérdida de tracking, cambios Guía/Espejo y velocidades 1×/0.5×.
7. Actualizar el informe para distinguir «compila», «animación implementada», «validado por especialista» y «puerta de control cumplida».

Esta auditoría no aplica las correcciones. Se conserva el trabajo funcional y todo el análisis queda local.
