# Correcciones del avatar del Sprint 1

El usuario solicita ejecutar las correcciones directamente, en local, sin push, usando las tres señas ya definidas en el JSON. No se espera un catálogo de 40 ni se inventarán nuevas referencias validadas.

Se conservarán Three.js, three-vrm y el formato existente. Se corregirán reposo, espacios 2D/3D, asignación anatómica de manos, muñeca local, articulación de dedos, overrides exactos, neutralización, tiempo/segmentos y aislamiento Guía/Espejo. Se recuperará un esqueleto de referencia compacto sin tapar al avatar y se alineará el canvas con el video.

Alternativas: restaurar íntegramente Kalidokit perdería correcciones posteriores; seguir invirtiendo índices no resuelve espacios incompatibles. Decisión del implementador: reparar la cinemática actual mediante bases ortonormales de palma y direcciones métricas, con pruebas deterministas y sin dependencias nuevas.

Las entradas actuales se conservan. Sus puntos artificiales se detectarán como datos de demostración para evitar que una cuadrícula se interprete como una mano; se usará la configuración declarada como respaldo visual, sin atribuir validación lingüística. La aceptación funcional no equivale al reconocimiento del especialista.

Límites: no motor DTW, autenticación, backend nuevo ni catálogo ampliado. El plan y las pruebas quedan en el repositorio. Se trabaja en una rama nueva desde main sin reescribir ramas históricas.
