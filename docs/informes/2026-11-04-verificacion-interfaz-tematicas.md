# VISEÑA · Implementación y verificación del inicio por temáticas

Fecha: 4 de noviembre de 2026. Rama local: `codex/RF-07-inicio-tematicas`.

**Actualización posterior a la implementación:** resultados finales consolidados y dependencias del Programador A. La entrega se desarrolló en la rama `codex/RF-07-inicio-tematicas`; sus commits y la integración local se consultan en el historial Git. Este documento complementa el [informe técnico general actualizado](2026-11-04-estado-tecnico-y-dependencias-programador-a.md).

## Estado consolidado

| Componente            | Estado actual                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Inicio y navegación   | Doce temáticas implementadas; todas abren la vista compartida de práctica                                                |
| Avatar y seguimiento  | Carga real comprobada en navegador; inicialización al ingresar y reutilización posterior                                 |
| Cámara                | Solicitud al ingresar, reintento y cancelación implementados; imagen física pendiente de permiso durante la verificación |
| Tres demostraciones   | HOLA en Saludos; GRACIAS y POR FAVOR en Cortesía; cuadros y límites originales conservados                               |
| Lote documental       | Cuarenta entradas en `docs`, organizadas en cuatro temáticas; sin secuencias de puntos en ese inventario                 |
| Lote de práctica real | Pendiente de recepción e integración desde A y revisión del especialista                                                 |
| Calidad local         | 34 pruebas aprobadas, compilación correcta y revisión independiente con hallazgos corregidos                             |
| G1                    | Pendiente de cuarenta referencias reales anotadas y cargadas; la interfaz ya permite organizarlas por unidad             |

## Alcance autorizado

Se implementa la interfaz solicitada por Lucas, reutilizando una sola vista de espejo/avatar para las doce temáticas. El paquete real de cuarenta referencias de A continúa pendiente de integración. No se modifica su segmentación.

Decisión respecto al plan: por la indicación de Lucas de permitir que todas las temáticas apunten a la misma pantalla, las doce tarjetas permiten entrar. Una temática sin referencias muestra un catálogo vacío y permite explorar el espejo; no copia referencias de otra unidad ni aparenta contener las cuarenta documentadas.

## Comportamiento implementado

- Inicio con las doce temáticas del ERS y conteos derivados del catálogo real de la aplicación.
- El modelo VRM no se construye ni descarga en Inicio. Tampoco se inicia la inferencia ni la cámara. El catálogo JSON se consulta para presentar su disponibilidad.
- Al ingresar se preparan de forma independiente avatar, seguimiento MediaPipe y cámara, con estado de cada recurso y reintento de errores.
- El catálogo se filtra por `unidad_tematica`. Todas las unidades usan el mismo HTML y los servicios existentes.
- Los modelos ya inicializados se reutilizan. Al volver se detienen cámara, captura, reproducción y los bucles de render; si existe una toma en grabación se detiene preservando sus cuadros para revisión.
- Las cargas tardías no reactivan una sesión abandonada. Los reintentos durante el permiso de cámara no duplican la apertura.
- Un fallo o permiso pendiente de cámara no bloquea el estudio del catálogo. Una temática vacía deshabilita los controles de reproducción; mantiene disponible Reflejo en Vivo.
- La descarga tardía del catálogo respeta el modo de avatar ya elegido por el usuario.
- El anotador conserva acceso separado y usa como unidad inicial la temática activa. Se oculta realmente al cerrar para evitar desbordamiento lateral y foco sobre controles fuera de pantalla.

## Comparación de las tres demostraciones con los documentos

| Demostración existente | Unidad previa | Unidad actual | Verificación                                                              |
| ---------------------- | ------------: | ------------: | ------------------------------------------------------------------------- |
| HOLA                   |             1 |   1 · Saludos | Filtro, selección y vista de guía comprobados                             |
| GRACIAS                |             1 | 12 · Cortesía | Selección, reproducción y cambio a 0,5× comprobados en navegador          |
| POR FAVOR              |             1 | 12 · Cortesía | Selección y actualización de parámetros/posición comprobadas en navegador |

Esta distribución corresponde al plan, que reserva GRACIAS y POR FAVOR para Cortesía. Se cambia únicamente la unidad temática de esas dos demos, sin alterar sus cuadros, intervalos ni parámetros. Los archivos siguen siendo demostraciones sintéticas y la interfaz lo indica. No se certifica su fidelidad LSEC ni se sustituyen por referencias reales.

La documentación del lote permanece en [el inventario de cuarenta entradas](../datos/lote-1-lsec-conadis-2026-10-30.md); no se utiliza como archivo de puntos de la aplicación.

## Pruebas automatizadas

Se añaden pruebas de comportamiento antes de implementar y se comprueban fallos y resultados correctos. Se utiliza la suite Node existente, sin nuevas dependencias.

Cobertura de regresión añadida:

- Doce temáticas sin inicializar recursos en Inicio.
- Carga de los tres recursos al ingresar, filtrado por unidad y reutilización de modelos.
- Temática sin referencias y controles de guía deshabilitados.
- Permiso de cámara denegado y reintento conservando el catálogo.
- Salida/reingreso durante cargas pendientes sin reactivar la sesión anterior.
- Error del avatar y reintento sin reiniciar recursos correctos.
- Error del catálogo sin bloquear el espejo.
- Cancelación de una solicitud de cámara que termina después de salir, liberando sus pistas.
- Cancelación del RAF del avatar para no duplicar bucles al reingresar.
- Reintento de modelo con cámara pendiente sin una segunda apertura.
- Reinicio de la etiqueta de reproducción al cambiar de temática.
- Conservación de Reflejo en Vivo ante una descarga tardía del catálogo.

La revisión independiente de código identificó dos problemas de estado: etiqueta de reproducción antigua y cambio involuntario a Guía al finalizar la descarga. Ambos se reprodujeron con pruebas que fallaban y se corrigieron antes de la verificación final.

Resultados finales: `npm test` aprobó **34 pruebas, con cero fallos**; `npm run build` completó TypeScript y Vite correctamente. Prettier aprobó HTML, CSS, TypeScript y pruebas modificadas. El JSON de demostraciones conserva una advertencia de formato ya presente en `HEAD`, comprobada por separado; se evita reformatear todo el archivo para un cambio de dos unidades temáticas. El empaquetado conserva la advertencia existente sobre un bundle principal mayor de 500 kB; no se introduce una dependencia nueva ni se implementa una migración de framework.

## Verificación visual

Se utilizó Vite limitado a `127.0.0.1:5174` y el navegador integrado. Se comprobaron doce tarjetas, entrada/regreso, Saludos/Cortesía, selección y reproducción de demos, temática vacía y espejo con simulación.

El navegador mostró **Avatar listo** y **Seguimiento listo** con los recursos reales. La cámara física permaneció en **Esperando cámara**, pendiente del permiso del navegador; no se afirma haber validado imagen física ni medido fps de captura durante esta comprobación. Los casos de permiso denegado, reintento y cancelación se verifican con pruebas automatizadas.

La vista móvil se comprobó a 390 × 844 y la vista de escritorio a su tamaño predeterminado, sin desbordamiento horizontal. Se restauró el tamaño del navegador después de la prueba.

## Pendientes de datos y alcance

La pantalla está preparada para mostrar referencias reales al reemplazar el paquete versionado por uno compatible y con `unidad_tematica` correcto. La anotación especializada, el lote real de A, la fidelidad completa del avatar por seña, el motor de evaluación y el funcionamiento offline completo mantienen su estado pendiente según los informes anteriores. Este cambio no acredita por sí solo G1 ni G2.

## Entrega inmediata esperada de A

1. Confirmar cuáles de las cuarenta referencias ya tienen extracción, segmentación y anotación completas, indicando su ubicación y versión. La ausencia en este checkout no demuestra ausencia de trabajo externo.
2. Entregar primero una referencia completa de cada temática para comprobar compatibilidad de puntos, tiempos, límites y animación.
3. Proporcionar el paquete versionado de cuarenta referencias con IDs estables, unidad temática, `frames`, marcas de tiempo, segmentación, parámetros fonológicos y procedencia LSEC, conciliado con el esquema 1.1.0.
4. Revisar con el especialista el significado y la ejecución de cada referencia, así como las sustituciones provisionales del inventario documental.

La interfaz temática no requiere cambiar la segmentación de A. Si un límite resulta inválido o corta el gesto, se devuelve la referencia concreta a A y al especialista con la evidencia. Los errores de reproducción o movimiento del avatar sobre datos correctos corresponden a B.

El motor de evaluación y los veredictos de ≤300 ms se mantienen como entregas para G2 y siguientes, sin convertirlos en requisito adicional para cerrar G1.
