# Plan de cierre del Sprint 1: lote segmentado e inicio por temáticas

**Fecha:** 4 de noviembre de 2026. **Cierre previsto por el ERS:** 15 de noviembre de 2026.

**Estado:** planificación para revisión. No autoriza ni ejecuta implementación.

**Objetivo:** integrar cuarenta referencias LSEC ya segmentadas, presentarlas por temática y comprobar su reproducción, para cumplir G1: cuarenta referencias anotadas y cargadas.

**Supuesto de entrada:** Lucas plantea que los cuarenta gestos ya están segmentados por A. Se acepta ese supuesto para planificar; no se certifica su contenido porque el paquete no se encontró en los archivos del lote revisados. El inventario documental con enlaces y las tres demostraciones de la aplicación no contienen las cuarenta referencias segmentadas.

**Tecnología y enfoque:** conservar Vite y TypeScript, el catálogo actual, MediaPipe y el avatar Three.js/three-vrm. Reutilizar los servicios existentes. Separar la navegación temática de los intervalos temporales producidos por A.

**Referencias:** ERS v1.0, secciones 6.1 y 7.2; RF-07, RF-08, RF-10, RF-36 y entregables iniciales de RF-42. Este plan precisa y sustituye el orden de trabajo del plan de 30 de octubre para el cierre de Sprint 1. El lote documental sigue siendo trazabilidad de fuentes; la lista definitiva de referencias procesadas por A y aceptadas por el especialista determina el contenido que se integra.

## 1. Qué se necesita recibir de A

Primero distinguir qué significa «segmentado», sin repetir trabajo ya hecho:

| Entrega disponible | Trabajo restante | ¿Rehacer segmentación? |
|---|---|---|
| JSON con puntos, tiempos, límites y cinco parámetros anotados | Validar e integrar en la aplicación | No |
| JSON con puntos y límites, pero sin anotación completa | Completar anotación con especialista y A; B prepara recepción | No, salvo que el especialista encuentre un límite incorrecto |
| Clips ya recortados, sin secuencias de puntos | A extrae puntos y prepara referencias; especialista anota | No por defecto; extracción no equivale a segmentación |
| Solo lista de enlaces y glosas | Falta la entrega de segmentación y puntos | No puede asumirse disponible |

La entrega para B debe permitir identificar: ID estable, glosa y sentido, correspondencia temática, versión, fuente, mano dominante, secuencia de cuadros con marcas de tiempo, límites de la seña y anotación de los cinco parámetros. Para animación se revisan pose de imagen, `pose_world`, manos con lateralidad y expresiones cuando correspondan.

Los campos requeridos y los nombres de la aplicación se contrastan con `data/schemas/referencia.schema.json` y `ReferenciaSenaData` en `app/src/anotador/annotation-service.ts`, actualmente versión 1.1.0. Si A entrega otra representación válida, se revisa primero si B puede consumirla mediante una conversión de formato que preserve los datos; no se cambia el contrato compartido unilateralmente.

**Regla:** «segmentado» no significa automáticamente «anotado» ni «listo para avatar». G1 requiere completar esos datos para las cuarenta referencias.

## 2. Límite de responsabilidad sobre la segmentación

**No se prevé modificar el algoritmo ni los intervalos definidos por A.** B carga y reproduce esos límites, sin detectar nuevamente inicio y fin, recortar cuadros adicionales ni modificar su duración para que el avatar parezca correcto.

| Hallazgo al integrar | Responsable y acción | Impacto sobre A |
|---|---|---|
| IDs o temática ausentes | Conciliar una tabla de correspondencia con A; mantener ID de origen y asociar unidad | Coordinación de metadatos; no segmentación |
| Nombres de campos o unidades de tiempo diferentes y documentados | B adapta la entrada con conversión verificable y conserva el original | Confirmar formato; no cambiar límites |
| Límites fuera del rango, inicio posterior al fin o convención global/local desconocida | Rechazar la referencia y comunicar ID, valores y motivo a A | A corrige exportación o confirma convención; no ajustar silenciosamente |
| Preparación incluida o movimiento final cortado, confirmado por especialista | Devolver la referencia concreta con observación y rango sugerido | Sí: A y especialista revisan esa segmentación |
| Tiempos originales inválidos o cuadros desordenados | Reportar el archivo a A | Corrección de datos/exportación; no necesariamente del algoritmo |
| Fuente correcta pero el reproductor ignora límites o altera velocidad | B corrige el reproductor | No tocar segmentación de A |
| Puntos correctos y avatar con dedos, palmas o brazos incorrectos | B corrige retargeting/calibración del modelo | No modificar puntos ni límites para compensar el rig |
| Solo hay rasgos normalizados para DTW y falta información para animar | Solicitar a A las pistas de puntos originales necesarias | Exportación/extracción adicional; no resegmentar por defecto |
| La lista real difiere de la preselección documental | Actualizar inventario y correspondencias de la app | No sustituir señas ni pedir nueva segmentación para encajar con una lista provisional |

Antes de cualquier cambio de segmentación se comunica a Lucas: referencia afectada, evidencia, qué falta, acción propuesta y efecto sobre G1. B no modifica código de A como parte implícita de este plan.

## 3. Organización temática para incorporar las referencias

Preparar las doce tarjetas del ERS. Para este lote se espera incorporar Saludos, Familia, Colores y Números, con diez referencias por unidad; confirmar esa distribución con los cuarenta archivos reales antes de fijarla.

- Tomar IDs y glosas del paquete real. El inventario anterior guía la conciliación y las fuentes, no reemplaza datos ya validados por A y el especialista.
- Resolver con el especialista los pendientes del inventario, especialmente CINCO/ONCE y VERDE/CELESTE. Si A ya segmentó CINCO o VERDE y su fuente está validada, conservarlos; no aplicar las sustituciones provisionales del inventario anterior.
- Una unidad está disponible cuando contiene referencias válidas. Mostrar su cantidad real; no anunciar diez si faltan archivos aceptados.
- Saludos puede incluir presentación personal como propuesta pedagógica; confirmar la adscripción de NOMBRE, CONOCER y NOSOTROS sin alterar sus secuencias.
- Las otras ocho unidades aparecen «Próximamente», sin activar recursos de práctica.
- El filtro se aplica a las opciones visibles y a la selección actual. Nunca conservar una seña de otra unidad al cambiar de temática.
- Mantener un paquete versionado completo y reutilizar `unidad_tematica`. No dividir descargas por temática ni introducir base de datos o API en esta entrega.

## 4. Flujo de la aplicación a entregar

**Inicio con temáticas → entrar en una unidad → preparar recursos → catálogo de esa unidad → observar referencia y practicar frente al espejo → volver.**

1. Inicio muestra doce temáticas y conteos; cámara, inferencia y render del avatar permanecen inactivos hasta ingresar.
2. Entrar en una temática con contenido carga el VRM y los modelos MediaPipe y solicita la cámara tras la acción del usuario. Se reutilizan recursos ya inicializados.
3. El catálogo muestra solo las referencias de la temática elegida; la primera queda en pausa, con reproducción 1×/0,5×, bucle y desplazamiento dentro del tramo anotado.
4. Si se deniega cámara, permanece disponible la observación del avatar y el esqueleto. Mostrar reintento sin bloquear el catálogo.
5. Guía utiliza exclusivamente la referencia; Espejo utiliza los puntos de cámara. Cambiar de temática reinicia la selección y pausa la reproducción anterior.
6. Volver detiene cámara, inferencia y reproducción. Una inicialización que termine después de salir no puede reabrir la cámara ni reactivar la vista. Conservar modelos cargados para el siguiente ingreso.
7. El anotador conserva un acceso separado para revisión del especialista. No crear segmentación automática nueva en esta tarea.

La entrada temática no produce aún veredictos, estrellas ni desbloqueos por rendimiento. Esas funciones corresponden a G2/G3. En Sprint 1, las unidades disponibles pueden explorarse; se documenta que RF-23 queda pendiente de la gamificación.

## 5. Secuencia de trabajo y dedicación de B

**Estimación:** 20 horas de B, con techo de planificación de 24 horas si aparecen ajustes de compatibilidad. Las horas de A y del especialista no están incluidas. Distribuirlas dentro de la capacidad disponible de B; no se añaden automáticamente sobre otras tareas del sprint. Las fechas son propuestas de ejecución, no afirmaciones de trabajo realizado.

| Orden / ventana | Entregable verificable | B | Dependencia |
|---|---|---:|---|
| 1 · 4–5 nov | Recepción del paquete y matriz de compatibilidad de las 40 referencias | 2 h | Archivos de A y estado de anotación |
| 2 · 5–6 nov | Una referencia real de cada temática cargada y reproducida respetando límites y tiempos; después, recepción de las cuarenta | 3 h | Datos compatibles y correspondencia de unidades |
| 3 · 6–9 nov | Inicio con doce tarjetas, cuatro unidades disponibles según conteos y filtro del catálogo | 4 h | Metadatos de las referencias; puede avanzar con muestras mientras llega el paquete |
| 4 · 9–10 nov | Inicialización al ingresar, permisos, regreso y cambio seguro de temática | 3 h | Flujo de navegación definido |
| 5 · 10–11 nov | VRM base y animación desde las referencias de muestra; registrar diferencias en las cuarenta | 3 h | Puntos aptos para animación y revisión inicial del especialista |
| 6 · 12–14 nov | Pruebas de regresión, revisión del catálogo completo, rendimiento y documentación de cierre | 3 h | Integración terminada y revisión cruzada |
| 7 · 15 nov | Margen para correcciones prioritarias y entrega de evidencias de G1 | 2 h | Resolución de incidencias que bloqueen el lote |

Si las correcciones del avatar superan el margen, priorizar cuarenta referencias anotadas/cargadas, esqueleto y reproductor correctos, modelo VRM base y prueba de animación. Registrar los ajustes finos para RF-42 en los sprints siguientes; no retrasar G1 intentando completar anticipadamente toda la fidelidad del avatar.

## 6. Archivos que se prevé tocar al implementar

| Área | Archivos | Cambio previsto |
|---|---|---|
| Inicio y práctica | `app/index.html`, `app/src/style.css`, `app/src/main.ts` | Tarjetas, navegación, estados y carga al ingresar |
| Catálogo | `app/src/catalogo/catalogo-service.ts` | Selección por unidad y consumo fiel de límites existentes |
| Datos de producto | Paquete versionado bajo `app/public/data/` | Incorporar las cuarenta referencias aceptadas, conservando versión previa |
| Cámara y visión | `app/src/camera/camera-service.ts`, `app/src/vision/vision-service.ts` solo si los servicios actuales lo requieren | Reutilización y ciclo de recursos; no extracción ni segmentación de referencias |
| Avatar | `app/src/avatar/vrm-loader-spike.ts` solo según hallazgos | Compatibilidad con puntos reales y ajustes mínimos del rig |
| Pruebas | `app/tests/catalogo.test.cjs`, `app/tests/integracion.test.cjs`, pruebas del avatar si se modifica su lógica | Casos de filtro, límites, navegación y recursos |
| Evidencias | Registro de recepción y cierre bajo `docs/` | Conteos, incidencias y resultados de verificación |

Se conserva el esquema 1.1.0 como referencia inicial. Un cambio de esquema se presenta como decisión conjunta con A, con justificación y compatibilidad; no se ejecuta como detalle oculto del frontend.

## 7. Comprobaciones previstas

Antes de implementar cada comportamiento nuevo, escribir un caso que falle y luego realizar el cambio mínimo. Reutilizar la suite Node existente. Este documento no ejecuta pruebas ni certifica resultados nuevos.

- **Datos:** cuarenta IDs únicos, cuarenta secuencias reales, cinco parámetros anotados, tiempos finitos y crecientes, límites válidos y correspondencia con las cuatro temáticas. Registrar por separado distribución pedagógica y cumplimiento de G1.
- **Segmentos:** elegir muestras con preparación y retorno y demostrar que selección, reproducción, reinicio, bucle y desplazamiento respetan el intervalo anotado por A. No apoyarse en el recorte automático de límites inválidos del reproductor: esos archivos se detectan antes de aceptarlos.
- **Tiempos:** 1×/0,5× respetan la duración derivada de las marcas de tiempo, sin falsear fps ni modificar el original. La interpolación visual no altera el paquete fuente.
- **Temáticas:** no aparecen señas de otra unidad; unidad vacía o paquete inválido muestran un estado recuperable y no abren cámara.
- **Recursos:** doble ingreso, regreso durante carga y cambio rápido de temática no duplican inicializaciones, pistas de cámara ni bucles.
- **Permisos:** cámara denegada permite observar referencia y ofrece reintento.
- **Avatar:** separar fallos de captura, de datos y del rig; mantener un esqueleto real visible y registrar la revisión por seña. Una pose de demostración de respaldo nunca se presenta como la seña real.
- **Accesibilidad básica:** foco visible, uso por teclado/táctil, controles de al menos 44 × 44 px, mensajes visuales y estados que no dependan solo del color.
- **Regresión técnica:** ejecutar `npm test` y `npm run build`; conservar resultados en el informe de cierre.
- **Rendimiento:** repetir captura ≥24 fps de promedio durante cinco minutos en las portátiles de desarrollo con avatar y esqueleto activos; identificar dispositivo y resolución. Distinguir cuadros nuevos procesados de repintados de pantalla.

La disponibilidad offline completa continúa como pendiente independiente si faltan service worker o recursos locales. No declararla resuelta por incorporar temáticas. Tampoco medir aún la latencia del veredicto como cumplimiento de G2 si el motor no está integrado.

## 8. Qué permite cerrar el sprint

**G1 esencial:** las cuarenta referencias están anotadas y cargadas en la aplicación, con catálogo y reproductor accesibles y sin depender de las tres demos.

**Entrega prevista de B:** anotador disponible; modelo VRM base; prueba de animación de pose y dedos; reproducción 1×/0,5× con esqueleto; recepción versionada sin recompilar; revisión cruzada y evidencias. La nueva pantalla temática organiza esos entregables y habilita las unidades que realmente tienen contenido.

**No se exige adelantar para cerrar G1:** veredicto DTW ≤300 ms, segmentación automática del aprendiz, semáforo correctivo, estrellas, desbloqueo por progreso, OpenHands ni modo investigación. La aceptación final del avatar de al menos 90 % de referencias se mantiene como objetivo RF-42 de fases posteriores, con revisión temprana en este sprint.

**Punto de arranque:** recibir el paquete real de A y revisar una referencia de cada temática. Si las cuatro se reproducen con los límites originales, continuar con las cuarenta y el inicio temático. Si hay una incompatibilidad, documentar qué referencia falla y si es problema de importación, anotación, exportación o segmentación antes de decidir quién corrige.
