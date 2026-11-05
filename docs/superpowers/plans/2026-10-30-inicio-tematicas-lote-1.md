# Plan de inicio por temáticas y preparación del lote 1 de VISEÑA

**Fecha:** 30 de octubre de 2026. **Estado:** propuesta para revisión; sin autorización de implementación.

**Plan vigente de cierre:** [4 de noviembre: integración del lote ya segmentado y temáticas](2026-11-04-cierre-sprint-1-lote-segmentado.md). Precisa las responsabilidades de A/B y prioriza G1; sustituye las estimaciones y la secuencia de trabajo de este documento. La fidelidad final de RF-42 se mantiene en fases posteriores, sin convertirla en requisito adicional de G1.

**Actualización de fuentes del mismo día:** el navegador sí permitió consultar el índice alfabético y cuarenta fichas del diccionario solicitado por Lucas. El [lote documental consultado](../../datos/lote-1-lsec-conadis-2026-10-30.md) y su [inventario JSON](../../datos/lote-1-lsec-conadis-2026-10-30.json) sustituyen la preselección de glosas de la sección 3. Las limitaciones de acceso de la sección 4 describen el intento inicial con la herramienta web; no implican que el portal haya quedado inaccesible. Continúan pendientes la validación del especialista, la autorización aplicable y la extracción de puntos. La implementación sigue sin ejecutarse.

**Objetivo:** organizar el acceso a la práctica por las unidades del ERS y preparar un lote de 40 referencias exclusivamente LSEC, con reproducción en esqueleto y avatar.

**Arquitectura propuesta:** conservar Vite, TypeScript, MediaPipe, Three.js y three-vrm. Reutilizar cámara, catálogo, anotador y reproductor actuales. Mostrar primero las temáticas; inicializar los recursos de práctica al ingresar en una unidad con referencias disponibles.

**Fuentes base:** `C:/Users/lvsld/Downloads/VISENA_ERS_v1.0_UCACUE.md`, especialmente 2.1, 2.4, 4.2, RF-23, 5, 6.1, 7.2 y 9; y `C:/Users/lvsld/Downloads/VISENA_Plan_Desarrollo_Programador_B.md`.

Este documento es planificación. No modifica la aplicación, los esquemas ni el paquete de referencias. Las estimaciones y las glosas siguientes son propuestas; no son una selección oficial atribuible al ERS.

## 1. Reglas del alcance

- El ERS exige 120 referencias, distribuidas en 12 unidades de diez, y tres entregas de 40: 15 de noviembre de 2026, 13 de diciembre de 2026 y 10 de enero de 2027.
- La selección lingüística corresponde al especialista en LSEC. Esta preselección sirve para organizar su revisión.
- Aceptar exclusivamente ejecuciones de Lengua de Señas Ecuatoriana. Una palabra en español no demuestra el origen de su seña.
- Usar videos de «Gabriel Román» para extracción solo con autorización escrita de CONADIS, según el ERS. Como alternativa prevista, usar grabaciones propias con dos o tres señantes LSEC; mientras tanto, preparar diez señas con el especialista.
- WLASL/ASL no aporta referencias al catálogo LSEC. El piloto OpenHands es independiente de este alcance.
- Las tres demostraciones del repositorio no cuentan como referencias reales ni como avance de G1.
- Mantener puntos clave, parámetros y metadatos; no incorporar videos fuente al producto.
- G0 se considera satisfecho según la medición de más de 24 fps reportada por Lucas. Su evidencia debe identificar equipo, resolución y promedio de cinco minutos; se repite al integrar la nueva pantalla y el avatar.

## 2. Temáticas de la pantalla principal

Los nombres proceden de la sección 6.1 del ERS. La numeración propuesta conserva el orden de esa sección; debe verificarse con A antes de asignar los identificadores definitivos.

| Unidad | Temática | Entrega propuesta | Referencias objetivo |
|---|---|---|---:|
| 1 | Saludos | Lote 1 · 15 nov 2026 | 10 |
| 2 | Familia | Lote 1 · 15 nov 2026 | 10 |
| 3 | Colores | Lote 1 · 15 nov 2026 | 10 |
| 4 | Números | Lote 1 · 15 nov 2026 | 10 |
| 5 | Días | Lote 2 · 13 dic 2026 | 10 |
| 6 | Escuela | Lote 2 · 13 dic 2026 | 10 |
| 7 | Alimentos | Lote 2 · 13 dic 2026 | 10 |
| 8 | Emociones | Lote 2 · 13 dic 2026 | 10 |
| 9 | Lugares | Lote 3 · 10 ene 2027 | 10 |
| 10 | Verbos frecuentes | Lote 3 · 10 ene 2027 | 10 |
| 11 | Preguntas | Lote 3 · 10 ene 2027 | 10 |
| 12 | Cortesía | Lote 3 · 10 ene 2027 | 10 |

La distribución de unidades por lote es una propuesta: el ERS fija cantidades y fechas, pero no esta asignación. Para Días, siete días no completan diez entradas: el especialista deberá seleccionar tres conceptos temporales LSEC adicionales, sin duplicar señas ni inventar clases.

## 3. Preselección del lote 1: 40 glosas candidatas

**Estado común de las 40:** pendientes de vincular a una entrada o grabación LSEC concreta, verificar derechos de uso, anotar y validar. No se presentan como cuarenta señas ecuatorianas ya comprobadas. No se crearán landmarks ni poses a partir de las palabras.

| Unidad | Diez glosas propuestas |
|---|---|
| Saludos | HOLA; ADIÓS; BUENOS DÍAS; BUENAS TARDES; BUENAS NOCHES; BIENVENIDO; NOMBRE; CONOCER; TÚ; NOSOTROS |
| Familia | FAMILIA; MADRE; PADRE; HERMANO; HIJO; ABUELO; TÍO; PRIMO; SOBRINO; ESPOSO |
| Colores | AMARILLO; AZUL; ROJO; VERDE; NEGRO; BLANCO; CAFÉ; NARANJA; ROSADO; MORADO |
| Números | UNO; DOS; TRES; CUATRO; CINCO; SEIS; SIETE; OCHO; NUEVE; DIEZ |

**Criterios de revisión de esta selección:**

- La unidad Saludos incluye presentación personal como propuesta pedagógica. El especialista puede sustituir las cinco últimas glosas si no corresponden al alcance acordado.
- BIENVENIDO y las fórmulas de saludo deben comprobarse como entradas lexicalizadas o referencias aisladas aceptadas; no construir oraciones uniendo señas.
- Mantener GRACIAS y POR FAVOR en Cortesía. Sus demos actuales no justifican ubicarlas en Saludos.
- No contar variantes de género, sinónimos o variantes regionales de una misma seña como referencias distintas para completar las cuarenta. Registrar las variantes que el especialista considere pertinentes.
- Confirmar que NARANJA corresponde al color, CAFÉ al color y CONOCER al sentido elegido. La glosa debe identificar el significado, no solo la palabra.
- No dar por hecho que los números o los colores se realizan igual que en ASL, LSM, LSE, LESCO u otra lengua.
- Seleccionar pares de señas visualmente similares solo después de observar las ejecuciones LSEC; no inferir similitud por significado. Marcar esos pares para RF-15.
- Si una candidata carece de fuente verificable, sustituirla por otra LSEC de la misma temática antes de cerrar el lote. La sustitución debe conservar diez referencias distintas por unidad.

### Primera entrega interna de diez para revisar la cadena completa

Priorizar HOLA, ADIÓS, BUENOS DÍAS, BUENAS TARDES, BUENAS NOCHES, PADRE, HERMANO, HIJO, UNO y DOS. Es una selección operativa dentro de las cuarenta, también sujeta a verificación. Si el especialista ya dispone de otras diez grabaciones LSEC válidas, reutilizarlas para probar la cadena sin alterar por ello el lote oficial.

## 4. Fuentes y evidencia lingüística

| Fuente del ERS | Función | Situación de esta revisión |
|---|---|---|
| Diccionario «Gabriel Román», CONADIS, 2014a | Fuente principal de las referencias | El acceso consultado devolvió un error; no fue posible verificar las cuarenta entradas individuales. |
| Canal CONADIS Ecuador | Localizar los videos originales del diccionario | Debe comprobarse autoría y correspondencia de cada video; no basta un enlace de un tercero. |
| Guía de ilustraciones, CONADIS, 2014b | Configuración manual: nueve grupos y 82 variantes | Referencia de anotación indicada por el ERS; no sustituye la secuencia temporal. |
| Glosario básico LSEC, Vicepresidencia, 2012 | Ubicación y movimiento; apoyo a la revisión de glosas | Se localizó el PDF institucional; la herramienta web no permitió abrirlo completo por su tamaño. No se verificó cada candidata en él. |
| Diccionario oficial LSEC, FENASEC, 2012 | Contraste lingüístico | Se consultó la página de FENASEC sobre el diccionario; no demuestra por sí sola la realización de cada candidata. |
| Grabación propia validada | Alternativa prevista en el ERS | Requiere señantes LSEC y revisión del especialista; disponibilidad por confirmar. |

Enlaces consultados:

- https://www.plataformaconadis.gob.ec/~platafor/diccionario/
- https://www.vicepresidencia.gob.ec/wp-content/uploads/downloads/2013/04/Compilacion-Final-Interactivo.pdf
- https://fenasec-ecu.wixsite.com/fenasec/diccionario

Preparar una ficha por candidata con: unidad, glosa y sentido; entrada/página o identificador de video; institución y lengua; variante regional si aplica; origen de la grabación; autorización aplicable; revisión del especialista; estado de puntos y anotación; resultado de esqueleto y avatar. Mantener esta ficha como registro de revisión hasta acordar con A su incorporación a los contratos.

**Regla de admisión:** sin evidencia LSEC, la candidata permanece fuera del paquete de práctica. La inaccesibilidad de una fuente no se resuelve incorporando una seña de otra lengua.

## 5. Flujo de interfaz propuesto

**Inicio → temática disponible → preparación → selección/observación de seña → práctica.**

### Inicio

- Mostrar las doce temáticas con título, orden y cantidad real de referencias disponibles sobre diez.
- Mostrar «Próximamente» cuando no existan referencias válidas. No activar cámara ni modelos desde una tarjeta vacía.
- Distinguir disponibilidad de contenido del bloqueo por progreso. En la primera fase, permitir explorar las unidades disponibles; dejar identificado este acceso como provisional de desarrollo. RF-23 se completa en el sprint de gamificación: dos estrellas en ocho de diez señas para habilitar la siguiente unidad.
- Mantener el anotador como acceso separado para especialistas, disponible antes de cargar el lote.

### Ingreso a la temática

- Cargar o reutilizar el modelo VRM y los modelos MediaPipe al entrar, como pidió Lucas.
- Solicitar permiso de cámara tras la acción explícita de entrar. Si se deniega, permitir estudiar el avatar y el esqueleto y ofrecer reintentar la cámara.
- Filtrar el catálogo por unidad antes de elegir la primera seña; no seleccionar una referencia de otra temática durante la carga.
- Mostrar «Preparando avatar», «Preparando seguimiento» y el estado de cámara. Permitir volver y reintentar ante error.
- Cargar el paquete versionado existente una sola vez y filtrar por `unidad_tematica`. No dividirlo en doce archivos ni crear una API para esta primera versión. Esto filtra las opciones visibles, aunque el archivo actual se descargue completo; separar descargas por temática se evaluará solo si el tamaño lo justifica.
- Mostrar la referencia en pausa, con reproducción 1× y 0,5× y esqueleto. Abrir la cámara no inicia una evaluación.

### Salida y cambio de temática

- Al volver a Inicio: detener las pistas de cámara, pausar reproducción y detener el registro si estaba activo, conservando la toma para su revisión.
- Conservar recursos ya cargados para reingresar sin nuevas descargas; no mantener render ni inferencia activos en Inicio.
- Si una carga termina después de salir, no debe reabrir cámara, reactivar práctica ni seleccionar contenido de la temática anterior.

## 6. Preparación y reproducción del lote

1. **Especialista:** confirma la lista, fuente, significado y realización LSEC de cada entrada.
2. **A y especialista:** obtienen la grabación autorizada o propia, extraen puntos y delimitan preparación, seña y retorno; anotan los cinco parámetros.
3. **A y B:** comprueban compatibilidad con el esquema actual 1.1.0 y las decisiones ADR del repositorio. Preservan tiempos reales; cualquier remuestreo para el motor se documenta sin falsear los fps capturados.
4. **A:** prepara el paquete versionado; B comprueba cuarenta identificadores únicos y diez referencias por unidad. Los cambios de contenido no requieren recompilar.
5. **B:** verifica esqueleto y avatar en modos guía/espejo, tiempos y velocidades; elimina la dependencia de manos sintéticas de respaldo en las referencias reales.
6. **Especialista:** revisa configuración de dedos, palma, ubicación, movimiento, cabeza y expresión por seña. B ajusta el retargeting o las poses cuando corresponda.
7. **Equipo:** registra resultados y publica internamente el paquete aprobado, conservando el paquete anterior para recuperación.

El avatar necesita los puntos originales adecuados para animación: pose de imagen y `pose_world`, manos con lateralidad y expresiones. No sustituirlos únicamente por rasgos normalizados para DTW. No cambiar a pistas precalculadas como parte implícita de esta tarea; sería una decisión adicional con A.

## 7. Trabajo previsto para B

Estimación incremental sobre lo ya implementado: **18–26 horas**, más revisión lingüística del especialista y trabajo de A. No sumar estas horas automáticamente al cronograma original: reemplazan parte de catálogo/avatar y deben ajustarse a las 15 h semanales de B.

| Orden | Entregable | Archivos existentes afectados al implementar | Horas B | Comprobación prevista |
|---|---|---|---:|---|
| 1 | Inventario de las 40 candidatas y sus fuentes | Registro documental nuevo; revisión de `data/schemas/referencia.schema.json` | 2–3 | Cada entrada tiene evidencia LSEC o estado pendiente; sin duplicados aceptados. |
| 2 | Inicio con doce temáticas y estados de disponibilidad | `app/index.html`, `app/src/style.css`, `app/src/main.ts` | 4–5 | Navegación con teclado/táctil; temas vacíos no abren cámara; inicio sin recursos pesados activos. |
| 3 | Carga al ingresar, regreso y filtro de señas | `app/src/main.ts`, `app/src/catalogo/catalogo-service.ts`; reutilizar cámara, visión y avatar | 4–6 | Entrar/salir/reintentar; permisos denegados; cambio rápido de unidad; cámara detenida al salir. |
| 4 | Recepción del primer paquete real | `app/public/data/referencias-v1.json` o su siguiente versión y registro de revisión | 2–3 | Cuarenta referencias reales, diez por unidad; rechazo de tiempos inválidos; reemplazo sin recompilar. |
| 5 | Revisión y ajuste del avatar con datos reales | `app/src/avatar/vrm-loader-spike.ts`, reproductor y anotador según hallazgos | 4–6 | Especialista reconoce al menos 36 de 40; restantes corregidas o mostradas solo con esqueleto. |
| 6 | Regresión y evidencia | Pruebas existentes en `app/tests/` y documentación | 2–3 | Pruebas y build correctos; rendimiento registrado en equipos disponibles. |

Antes de implementar comportamiento nuevo, escribir las pruebas de navegación, filtro y ciclo de cámara, comprobar que fallen y realizar el cambio mínimo hasta que pasen. Añadirlas a la suite Node existente; no incorporar otro framework de pruebas.

## 8. Aceptación y riesgos que se deben comprobar

- Inicio muestra exactamente las doce temáticas del ERS, con conteos reales y sin afirmar que las demos son referencias validadas.
- Cada práctica muestra exclusivamente las señas de su temática. Permisos denegados no impiden observar una referencia disponible.
- Un paquete vacío, inválido o inaccesible presenta un estado recuperable; no habilita práctica con datos anteriores de otra unidad.
- Dos clics rápidos o una salida durante la carga no duplican cámara, bucles o inicialización ni reabren recursos después de salir.
- La reproducción mantiene segmentos y tiempos a 1×/0,5× y no invade el modo espejo. Los errores del avatar no ocultan un esqueleto disponible.
- Controles de al menos 44 × 44 px, foco visible, estados comprensibles sin depender solo del color y uso completamente visual, conforme a RNF-11/12.
- Medir captura ≥24 fps como promedio de cinco minutos con cámara, esqueleto y avatar activos; no confundir fps de renderizado con inferencias sobre cuadros nuevos.
- Registrar arranque ≤5 s en cinco repeticiones, especificando condiciones y dispositivo. La demora del usuario al responder el permiso de cámara se registra por separado.
- Programar prueba offline con todos los recursos instalados. La ausencia actual de `sw.js` y la carga de WASM desde CDN siguen pendientes; este plan no los da por resueltos.
- Ejecutar `npm test` y `npm run build` al implementar. Esta planificación no ejecuta ni certifica nuevas pruebas de funcionamiento.

## 9. Hitos y decisión de cierre

| Hito | Fecha ERS | Evidencia |
|---|---|---|
| G0 | 1 nov 2026 | Informe de rendimiento; se incorpora la medición reportada y se documentan condiciones. |
| G1 | 15 nov 2026 | 40 referencias LSEC anotadas y cargadas. El inicio temático facilita el acceso, pero no sustituye los datos. |
| G2 | 29 nov 2026 | Una seña completa con motor y corrección ≤300 ms; trabajo posterior con A. |
| G3 / RF-42 | 13 dic 2026 | Cuatro unidades jugables, progreso y revisión lingüística del avatar. Preparar la revisión desde el lote 1 reduce retrabajo. |

Este plan queda listo para revisión de Lucas, A y el especialista. La selección final de cuarenta requiere comprobar las entradas y resolver las sustituciones necesarias; no se declara cerrada por haber enumerado cuarenta palabras. La implementación permanece pendiente por instrucción expresa de Lucas.
