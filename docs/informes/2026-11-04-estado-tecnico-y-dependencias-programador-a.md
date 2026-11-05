# VISEÑA · Informe de estado técnico y entregas necesarias del Programador A

**Fecha de corte:** 4 de noviembre de 2026.  
**Proyecto:** VISEÑA · Universidad Católica de Cuenca · Fondo INVENTA.  
**Periodo evaluado:** desarrollo local disponible hasta el Sprint 1.  
**Versión de aplicación:** 0.1.0. **Base de implementación:** commit `5494f74`; rama de desarrollo `codex/RF-07-inicio-tematicas`; consultar el historial Git para el estado de su integración local.  
**Objeto:** describir el funcionamiento técnico implementado, reconocer el lote documental existente y precisar qué se necesita de A para cargar referencias reales y continuar la evaluación automática.

**Actualización:** incorpora la interfaz de doce temáticas y la verificación posterior de 34 pruebas aprobadas. Detalle de la entrega en el [informe de interfaz y verificación](2026-11-04-verificacion-interfaz-tematicas.md).

## 1. Estado ejecutivo

VISEÑA dispone de una base implementada de captura, detección de puntos, visualización de esqueleto y animación del avatar VRM. La aplicación conecta los movimientos captados por cámara con brazos, muñecas y dedos del avatar, y puede reproducir secuencias de referencia mediante su catálogo. El modelo 3D está incluido y existen pruebas de su jerarquía de huesos.

**El avance actual permite demostrar el seguimiento y la animación; todavía no permite certificar que un aprendiz realiza correctamente una seña LSEC.** La detección MediaPipe produce coordenadas; el retargeting mueve el avatar; la evaluación fonológica requiere referencias anotadas y el motor específico.

**Sí existe documentación de las cuarenta referencias:** un catálogo Markdown y un inventario JSON en `docs/datos/`, organizados en cuatro temáticas de diez. Estos archivos contienen glosas, fichas del diccionario y enlaces de video. No contienen puntos, límites temporales ni anotación completa para evaluar/reproducir esas cuarenta señas.

En el checkout revisado no se encontró el paquete técnico de cuarenta referencias reales, el kit de extracción ni el motor de evaluación de A. Esta constatación significa **entrega aún no disponible en este repositorio local**; no permite concluir que A no haya trabajado en otros archivos, equipos o ramas no revisados. Para este informe se planifica el escenario solicitado: ninguna entrega técnica de A disponible para integrar.

## 2. Evidencia y alcance de la revisión

Se inspeccionaron código fuente, modelos locales, datos públicos de la app, inventario documental, esquemas, ADR, pruebas y configuración de CI. También se ejecutaron `npm test` y `npm run build` el 4 de noviembre.

| Verificación                              | Resultado observado                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pruebas automatizadas                     | 34 aprobadas, 0 fallos, 0 omitidas                                                                                                             |
| Compilación TypeScript y empaquetado Vite | Correctos, código de salida 0                                                                                                                  |
| Advertencia de empaquetado                | JavaScript principal de 862,99 kB; gzip 226,39 kB; supera el umbral de aviso de 500 kB                                                         |
| Catálogo de producto                      | Tres demostraciones: HOLA (45 cuadros), GRACIAS (40) y POR FAVOR (48); HOLA en Saludos (unidad 1); GRACIAS y POR FAVOR en Cortesía (unidad 12) |
| Inventario documental                     | 40 entradas, 40 IDs propuestos únicos, 40 fichas únicas y 40 IDs de video únicos; ninguna entrada contiene `frames`                            |
| Directorios `motor/` y `tools/`           | No presentes en este checkout                                                                                                                  |
| Service worker público `app/public/sw.js` | No presente                                                                                                                                    |

Las pruebas incluyen lógica de movimiento, asociación de manos, encuadre, reproducción temporal, exportación de captura, separación guía/espejo y una comprobación de orientación de palma con el rig real. Varias pruebas utilizan dobles de DOM y detectores; no equivalen a una prueba física de cámara ni a una validación de lengua de señas. El mensaje de rechazo de catálogo que aparece durante `npm test` corresponde a un caso negativo esperado que pasó.

Se verificó en navegador la interfaz de temáticas, el avatar, MediaPipe, la reproducción y el espejo con simulación; también se comprobó la vista móvil. No se volvió a medir la cámara física, no se levantó Docker ni se comprobó CI remota en esta revisión. Lucas reportó previamente más de 24 fps: se conserva como rendimiento informado, pendiente de acompañar con equipo, resolución y registro de cinco minutos. No se reabrieron los cuarenta videos; el estado documental se comprobó en los archivos ya elaborados.

## 3. Funcionamiento técnico actual

### 3.1 Captura de cámara

[CameraService](../../app/src/camera/camera-service.ts) solicita cámara mediante `navigator.mediaDevices.getUserMedia`, sin audio. La configuración solicita idealmente 640 × 480 y 30 fps; estos valores son una petición al dispositivo, no una medición de rendimiento garantizada. Se gestionan permisos denegados, ausencia de cámara y contexto no compatible, y se detienen las pistas al apagar la captura.

### 3.2 Detección y percepción de puntos

[VisionService](../../app/src/vision/vision-service.ts) utiliza tres tareas de MediaPipe Tasks Vision: PoseLandmarker, HandLandmarker y FaceLandmarker. Aunque parte de la documentación menciona Holistic, la implementación actual inicializa estos tres detectores por separado.

- Pose: 33 puntos de imagen y coordenadas `poseWorld` cuando están disponibles.
- Manos: hasta dos manos, con 21 puntos por mano y asociación por proximidad a muñecas corporales y continuidad temporal.
- Rostro: subconjunto de puntos para dibujo y coeficientes de expresión facial.
- Encuadre: comprobación de rostro, hombros y ambas manos, mantenidos durante un segundo para declarar encuadre válido.

La inferencia ocurre en el navegador, configurada con delegado GPU. Los archivos `.task` están en `app/public/models/`; el runtime WASM se solicita actualmente a un CDN. Descargar los recursos no implica que el video se procese en ese CDN: las llamadas de detección reciben el video local del navegador.

[El bucle principal](../../app/src/main.ts) detecta cuando cambia `video.currentTime`, procesa ese cuadro y reutiliza la última detección en repintados posteriores. El contador de fps considera cuadros nuevos procesados, con una rama de simulación que debe excluirse de cualquier medición real.

**Límite funcional:** estos puntos describen dónde están cuerpo y manos. No identifican por sí mismos HOLA, GRACIAS u otra seña ni producen una evaluación de corrección.

### 3.3 Esqueleto sobre la imagen

[SkeletonRenderer](../../app/src/render/skeleton-renderer.ts) dibuja pose, manos y puntos faciales sobre canvas. La imagen de cámara y el esqueleto se presentan con geometría de espejo coherente. Hay lógica para conectar codos con las muñecas detalladas de manos y evitar uniones cruzadas evidentes.

Esta visualización permite observar la captura; no constituye todavía resaltado correctivo de errores fonológicos emitidos por un motor.

### 3.4 Modelo y movimiento del avatar

[VrmAvatarViewer](../../app/src/avatar/vrm-loader-spike.ts) carga `/models/visenia.vrm` mediante GLTFLoader y VRMLoaderPlugin, prepara escena, iluminación, cámara y render WebGL. El binario VRM presente tiene 7.504.812 bytes.

La implementación de movimiento es principalmente **retargeting propio con Three.js**. Kalidokit está declarado como dependencia, pero el archivo del avatar revisado calcula directamente las rotaciones; no se debe presentar como un solver Kalidokit ejecutándose en ese flujo.

- Usa preferentemente `poseWorld` para orientar brazos, sin mezclar la escala de profundidad corporal con la de manos.
- Calcula orientación de muñeca y flexión de falanges desde los 21 puntos de cada mano.
- Interpola rotaciones para suavizar movimiento y retorna a reposo cuando falta seguimiento.
- Admite `vrm_pose_override` para aplicar cuaterniones específicos por hueso.
- Mapea expresiones limitadas: parpadeo izquierdo/derecho, apertura de boca y sonrisa. No implementa todavía todo el repertorio no manual de LSEC.

La animación actual se centra en brazos, manos y esas expresiones. No se encontró en el flujo revisado un seguimiento completo de orientación de cabeza/torso equivalente a todos los componentes exigidos por RF-42; el movimiento de cuello de reposo no demuestra ese seguimiento.

**Interpretación del avance:** existe un modelo cargable y un mecanismo de movimiento definido. Falta comprobar que reproduce de forma lingüísticamente reconocible cada referencia real. Un avatar que imita puntos no está automáticamente validado para enseñar cuarenta señas.

### 3.5 Dos fuentes de movimiento separadas

| Modo   | Fuente                 | Comportamiento                                                     |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| Guía   | Secuencia del catálogo | El avatar y el esqueleto de referencia siguen los cuadros del JSON |
| Espejo | Landmarks de cámara    | El avatar refleja los movimientos captados del usuario             |

La aplicación separa ambos modos para que desplazar el reproductor no sobrescriba el reflejo en vivo. El inicio actual muestra doce temáticas y consulta el catálogo para presentar conteos. El VRM, MediaPipe y la cámara se preparan al entrar en una temática. Cada recurso tiene su estado y reintento; los modelos preparados se reutilizan y al volver se detienen cámara y bucles de animación. La cámara física permaneció pendiente de permiso durante la verificación visual.

### 3.6 Catálogo y reproducción

[CatalogoPlayerService](../../app/src/catalogo/catalogo-service.ts) carga `/data/referencias-v1.json`, valida una estructura básica y marcas de tiempo crecientes, selecciona referencias y reproduce el segmento definido por sus límites. Implementa pausa, reinicio, desplazamiento, bucle, velocidades 1×/0,5× e interpolación temporal.

Las tres entradas actuales son demostraciones. El código detecta manos sintéticas heredadas y usa una mano abierta anatómica de respaldo; una prueba confirma ese estado de demostración. No se deben contar esas entradas como tres referencias LSEC reales validadas.

La selección visible se filtra por `unidad_tematica`. Las doce tarjetas llevan a la misma vista de espejo/avatar y muestran su catálogo correspondiente. Las unidades sin referencias permiten explorar el espejo, indican contenido próximo y deshabilitan los controles de guía; no reutilizan demostraciones de otra temática.

### 3.7 Anotador y contratos

[AnnotationService](../../app/src/anotador/annotation-service.ts) captura puntos por cuadro, permite seleccionar un tramo y exporta un documento de referencia versión 1.1.0. Conserva tiempos relativos del tramo, reindexa los cuadros y rechaza capturas con tiempos inválidos o promedio inferior a 15 fps.

Su recorte de una toma es una herramienta de anotación manual. No sustituye la segmentación automática del aprendiz ni demuestra que el lote de A haya sido segmentado.

**Revisión pendiente:** el formulario y exportador usan valores predeterminados para orientación de palma, tolerancias, repeticiones, descripciones y una expresión facial de ejemplo. No todos son mediciones o etiquetas revisadas por especialista. La presencia de los cinco objetos fonológicos en un JSON no prueba que los cinco parámetros hayan sido anotados correctamente.

Los [esquemas de referencia](../../data/schemas/referencia.schema.json) y [ejecución](../../data/schemas/ejecucion.schema.json) están disponibles. Son contratos para intercambio; el esquema de ejecución no significa que ya exista el motor que rellena puntajes y veredictos. La carga del catálogo hace comprobaciones parciales, no una validación exhaustiva de todos los requisitos del esquema y de calidad de datos.

### 3.8 Backend, PWA y automatización

El [backend FastAPI](../../server/main.py) dispone de `/api/health` y `/api/version`. No hay en el archivo actual persistencia de ejecuciones, exportación del banco, sincronización ni inferencia. `database_connected` refleja la presencia de una variable de entorno, no una consulta real de conexión a PostgreSQL.

Existe infraestructura declarada en Docker Compose y manifiesto web. El funcionamiento offline completo no está acreditado: se intenta registrar un service worker ausente y el WASM depende del CDN.

Hay [workflow de CI](../../.github/workflows/ci.yml) para formato, sintaxis de esquemas y pruebas. La comprobación de esquemas usa `JSON.parse`, que verifica sintaxis, no conformidad de referencias. En este informe solo se acreditan las pruebas y compilación locales ejecutadas, no el estado del pipeline remoto ni la cobertura de pruebas del motor.

Los ADR describen también interfaces de fuentes abstractas y un adaptador del motor. No se encontraron sus implementaciones completas en el flujo revisado; sus afirmaciones se toman como decisiones/documentación y no como evidencia automática de integración.

## 4. Estado real de las cuarenta referencias en docs

Se revisaron el [catálogo documental](../datos/lote-1-lsec-conadis-2026-10-30.md) y su [inventario JSON](../datos/lote-1-lsec-conadis-2026-10-30.json).

| Temática  | Entradas documentadas | Con secuencia de puntos dentro del inventario | Estado lingüístico indicado |
| --------- | --------------------: | --------------------------------------------: | --------------------------- |
| Saludos   |                    10 |                                             0 | Pendiente del especialista  |
| Familia   |                    10 |                                             0 | Pendiente del especialista  |
| Colores   |                    10 |                                             0 | Pendiente del especialista  |
| Números   |                    10 |                                             0 | Pendiente del especialista  |
| **Total** |                **40** |                                         **0** | **Revisión pendiente**      |

Cada entrada ya tiene ID propuesto, unidad, glosa, título de la ficha, URL de origen y enlace de video. El inventario declara para las cuarenta `estado_puntos: no_extraidos`, `estado_avatar: no_validado` y `estado_validacion: pendiente_especialista`.

**Logro documental reconocido:** selección y organización del lote, con trazabilidad hacia la fuente ecuatoriana, registrada el 30 de octubre. No es necesario repetir esta catalogación desde cero.

**Trabajo técnico no contenido en esos archivos:** `frames`, marcas de tiempo por cuadro, límites de segmentación, parámetros anotados y correcciones del avatar. Las cuarenta entradas documentadas no están incorporadas al catálogo ejecutable de la app.

Pendientes específicos del inventario que A y el especialista deben resolver al recibirlo:

- CINCO no fue localizado en la consulta original; ONCE ocupa una plaza provisional. La unidad no representa una secuencia completa de uno a diez.
- VERDE no fue localizado en aquella consulta y se incluyó CELESTE; CAFÉ se sustituyó por PLOMO por ambigüedad de significado.
- Confirmar el sentido familiar de «Anciano(a), Abuelo» y los sentidos de color de las fichas correspondientes.
- Confirmar la ubicación pedagógica de las entradas de presentación personal dentro de Saludos.
- Comprobar reproducción efectiva de los videos y la autorización para procesarlos conforme al ERS. Si se usan grabaciones propias LSEC validadas, registrar ese origen.

Las sustituciones son provisionales. Si A aporta referencias ya procesadas y aceptadas, conservar esa selección y actualizar el inventario; no obligarlo a resegmentar para coincidir con una lista preliminar.

## 5. Entregas necesarias de A para cerrar G1

La necesidad inmediata no se limita a «verificar»: en el escenario sin entrega técnica, A debe proporcionar el material procesado que B pueda cargar. La validación lingüística corresponde al especialista y la integración a B.

| Prioridad                | Entrega de A, coordinada con especialista         | Contenido verificable                                                                                                             | Uso por B                                                                         |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P0 · inmediata           | Confirmación de disponibilidad y lista definitiva | Qué archivos existen, cuáles están segmentados, cuáles tienen puntos/anotación y qué referencias corresponden a cada temática     | Identificar dependencias reales y conciliar los cuarenta IDs                      |
| P0 · primera integración | Cuatro referencias completas, una por temática    | Mismos campos y calidad del lote final, sin ejemplos sintéticos                                                                   | Probar formato, segmentos, coordenadas y animación antes de integrar las cuarenta |
| P0 · G1                  | Paquete versionado de cuarenta referencias reales | Puntos, tiempos, límites, cinco parámetros anotados, metadatos y correspondencias                                                 | Cargar el lote y cerrar G1 junto con la revisión del especialista                 |
| P0 · G1                  | Evidencia de revisión y procedencia               | Fuente LSEC, variante/sentido, responsable de anotación y estado de aceptación                                                    | Mantener trazabilidad y no enseñar referencias no revisadas                       |
| P0 · G1                  | Convenciones de exportación                       | Índices locales/globales, extremos inclusivos/exclusivos, unidades de tiempo y coordenadas, lateralidad, tratamiento de faltantes | Consumir los datos sin cambiar el contenido del gesto                             |
| Soporte de integración   | Correcciones de datos concretas                   | Archivo/ID corregido, versión y motivo                                                                                            | Reemplazar referencias defectuosas sin rehacer el frontend                        |

### Contenido mínimo esperado del paquete

Usar el contrato actual 1.1.0 como punto de conciliación: `schema_version`, `id`, `glosa`, `unidad_tematica`, `mano_dominante`, `metadatos_grabacion`, `segmentacion`, `parametros_fonologicos` y `frames`. Para cada cuadro: índice, tiempo y pistas disponibles de pose, pose en mundo, manos y expresiones pertinentes.

Requisitos prácticos: cuarenta IDs únicos; límites dentro del arreglo; tiempos finitos y crecientes; fps y duración reales; identificación de manos coherente; anotación por seña y expresión requerida cuando corresponda. La asignación de diez referencias a cada una de las cuatro primeras temáticas se concilia con la lista definitiva.

El dato apto para DTW no siempre basta para animar el avatar. Si A entrega solo rasgos normalizados, debe aportar las pistas originales necesarias o acordar otra representación de animación. Las dos necesidades se resuelven conjuntamente sin modificar unilateralmente los contratos.

## 6. Entregas posteriores de A: G2 y siguientes

Estas entregas deben planificarse, pero no se añaden como requisito anticipado para cerrar G1:

- Motor TypeScript de evaluación de los cinco parámetros, DTW y lectura de umbrales por seña.
- Interfaz de integración documentada: entrada, versión, estados y errores; salida con puntajes, veredicto y parámetros afectados.
- Calibración, casos reproducibles y evidencia de paridad con la implementación de referencia.
- Para los hitos correspondientes: segmentación automática del intento del aprendiz, tratamiento de zurdos y vecino más cercano.
- Medición de latencia desde el fin de la seña hasta su corrección, con objetivo de ≤300 ms para G2 y RNF-03.

OpenHands no está integrado. Su prueba experimental no sustituye las referencias LSEC, la evaluación correctiva ni la entrega de G1.

## 7. Cuándo habría que tocar la segmentación de A

**La carga temática y la animación no requieren resegmentar por sí mismas.** B debe respetar los intervalos entregados y corregir su reproductor o retargeting si falla al consumir datos correctos.

| Situación                                                         | Acción                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| La segmentación existe fuera del repositorio                      | Solicitar el paquete y registrar su versión; no declarar que no se ha realizado              |
| Solo se entregan clips recortados                                 | A extrae puntos y completa exportación; no supone rehacer el recorte                         |
| No se entrega segmentación ni puntos                              | A y especialista preparan la referencia; B no puede deducirla desde el inventario de enlaces |
| Índices fuera de rango o convención desconocida                   | Detener la aceptación de esa referencia y consultar a A; no ajustar límites silenciosamente  |
| Inicio/fin corta parte del gesto o incluye preparación incorrecta | A y especialista revisan la referencia concreta; avisar a Lucas antes del cambio             |
| Esqueleto correcto y avatar incorrecto                            | B ajusta el rig/retargeting; no modifica puntos ni duración para disimular la diferencia     |
| Seña asignada a una temática distinta                             | Conciliar metadatos y selección; no cambia los límites del movimiento                        |

## 8. Trabajo de B que puede continuar ahora

1. Inicio con doce temáticas implementado y verificado; mantener sus conteos asociados a las referencias realmente cargadas.
2. Filtrado por unidad implementado; incorporar el paquete real sin cambiar esa navegación.
3. Carga al ingresar, reintentos y apagado al volver implementados; completar la comprobación de cámara física con permiso y registrar rendimiento.
4. Mantener el anotador disponible y revisar los valores predeterminados para que el especialista identifique qué debe completar.
5. Preparar recepción de una referencia real por temática, con casos de tiempos, límites y cambio guía/espejo.
6. Documentar rendimiento y realizar revisión del avatar con datos reales en cuanto lleguen.

La interfaz temática ya funciona con datos de prueba identificados como demostraciones. La aceptación de las cuarenta referencias reales y su fidelidad lingüística siguen dependiendo de los archivos y revisión correspondientes.

## 9. Estado frente a los hitos

| Hito                                               | Estado respaldado al corte                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 · ≥24 fps en portátiles                         | Cumplimiento reportado por Lucas; falta anexar en este informe un registro reproducible de cinco minutos. La nueva revisión no lo midió otra vez.        |
| G1 · 40 referencias anotadas y cargadas · 15 nov   | No acreditado todavía: existe documentación de cuarenta, pero el catálogo de producto contiene tres demos.                                               |
| Base de B para Sprint 1                            | Cámara, puntos, esqueleto, VRM, movimiento, reproductor, anotador, temáticas, contratos y pruebas implementados; requieren integración con el lote real. |
| Inicio por temáticas                               | Implementado: doce tarjetas, vista compartida, filtro por unidad y carga de recursos al ingresar.                                                        |
| G2 · práctica completa con veredicto ≤300 ms       | Pendiente de motor y referencias reales; no medible aún como flujo completo.                                                                             |
| RF-42 · avatar reconocible en ≥90 % de referencias | Mecanismo de animación disponible; aceptación lingüística no acreditada. Se desarrolla y valida progresivamente en fases posteriores.                    |

No se asigna un porcentaje global: la ejecución de pruebas, los componentes de visualización y la catalogación documental no tienen el mismo alcance que cuarenta referencias reales o un motor evaluador.

## 10. Próxima entrega recomendada

Entregar a A y al especialista el inventario ya organizado, y recibir una respuesta por cada referencia: disponible/no disponible, fuente, extracción, segmentación, anotación y aceptación. A continuación integrar una referencia real por temática y escalar a cuarenta una vez comprobada la compatibilidad.

Para el cierre del 15 de noviembre, priorizar lote real anotado, carga versionada, catálogo/reproductor y prueba del avatar base. Mantener las mejoras finas de fidelidad y la evaluación automática en sus hitos sin retrasar la recepción de datos.

**Conclusión técnica:** la base de percepción y animación está implementada y supera las pruebas locales actuales. El inventario documental de cuarenta referencias está preparado y organizado. La dependencia inmediata es recibir de A los datos procesados y su revisión con el especialista; B ya dispone de la interfaz temática implementada y puede continuar la recepción e integración, pero no acreditar G1 con enlaces o demostraciones sintéticas.

## 11. Documentos relacionados

- [Lote documental de cuarenta referencias](../datos/lote-1-lsec-conadis-2026-10-30.md).
- [Inventario de fuentes en JSON](../datos/lote-1-lsec-conadis-2026-10-30.json).
- [Plan actualizado de cierre del Sprint 1](../superpowers/plans/2026-11-04-cierre-sprint-1-lote-segmentado.md).
- [ADR-001: formato de puntos](../adr/ADR-001-formato-puntos-clave.md).
- [ADR-002: avatar VRM](../adr/ADR-002-retargeting-avatar-vrm.md).
- ERS original revisado en esta conversación: `C:/Users/lvsld/Downloads/VISENA_ERS_v1.0_UCACUE.md`; sus metas no sustituyen evidencia de implementación.

Informe actualizado mediante inspección y evidencias de la implementación local de temáticas. La actualización documental no añade cambios de producto ni modifica archivos o segmentación de A.
