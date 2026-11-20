# Evaluación local del reconocimiento ASL

## Por qué se cambió el checkpoint

El BiLSTM anterior carga los pesos originales correctamente, pero su decoder
recibe una matriz `(1, T, 54)` con `batch_first=False`. PyTorch interpreta
un solo paso temporal y `T` elementos de lote. Al alterar el orden de los
fotogramas de una referencia de 22 imágenes, la diferencia máxima de
probabilidades fue `0.00000155`. Esa arquitectura no representa el orden del
movimiento. Mantener los pesos y cambiar `batch_first` tampoco es válido:
alteraría la función que se entrenó.

El endpoint de cámara ahora usa el [checkpoint BERT WLASL2000 publicado por
OpenHands](https://openhands.ai4bharat.org/en/latest/instructions/models.html).
El [artículo de OpenHands](https://aclanthology.org/anthology-files/queue/pdf/acl/2022.acl-long.150.pdf)
reporta 23,2 % de acierto de primera clase para BERT en el conjunto de prueba
WLASL2000. Esa cifra no mide esta adaptación ni esta cámara; muestra que el
checkpoint general no puede sostener una promesa de reconocimiento perfecto.
Su [configuración](https://github.com/AI4Bharat/OpenHands/blob/main/examples/configs/wlasl/pose_transformer.yaml)
selecciona 27 puntos, toma uniformemente 120 fotogramas antes de normalizar y
usa posiciones temporales. El cargador exige coincidencia exacta de todos los
pesos. En una comprobación de orden, invertir los 120 fotogramas cambió la
probabilidad máxima en `0.516`; repetir la misma inferencia no la cambió. Se
desactivó durante la inferencia un dropout que el código original aplicaba
incluso en modo de evaluación.

## Seis grabaciones de práctica

Se probaron cinco videos iniciales: dos intentos etiquetados como DRINK y tres
con la mano opuesta. También se examinó una sexta grabación etiquetada como
correcta, hecha con la misma cámara que produjo una predicción errónea en la
página. Esa cámara entregó aproximadamente 7,6 imágenes por segundo; la
captura de 3,5 segundos mostrada en la página solo contenía 27 imágenes.
Los seis videos se enviaron como JPEG al WebSocket local; a 30 fps algunos
fotogramas se descartaron por la cola limitada de procesamiento. Las capturas
y sus landmarks temporales no se incluyen en el repositorio.

La persona confirmó que el archivo de WhatsApp fue invertido por la cámara
frontal. La prueba de ese archivo se repitió con inversión horizontal antes de
enviarlo: entonces se observó la mano derecha, aunque BERT siguió sugiriendo
otra clase. La página muestra la vista previa invertida con CSS, pero envía
los píxeles originales al servidor.

| Comprobación | Tres intentos etiquetados como correctos | Tres con mano opuesta |
| --- | ---: | ---: |
| BERT con la secuencia completa sugirió `drink` | 1 | 0 |
| BERT con tramo del gesto y mano solicitada sugirió `drink` en el WebSocket | 2 | 0 |
| Se observó la mano derecha hacia la boca en el WebSocket (WhatsApp corregido) | 3 | 0 |

El movimiento de una mano hacia la boca, sin distinguir el lado, apareció en
los seis videos. La página local ahora solicita la mano derecha y presenta
por separado la observación de cada mano. Si se acerca únicamente la
izquierda, ofrece repetir con la derecha aunque el clasificador sugiera otra
palabra. Si se acerca la derecha, describe solo ese hecho; no afirma que toda
la seña fue correcta. La opción `practice_hand: "either"` conserva la práctica
sin lado obligatorio para personas zurdas o ejercicios que lo permitan. Si
se observó el acercamiento con la mano solicitada, la entrada BERT conserva
el intervalo desde la primera hasta la última cercanía a la boca, con 0,8 s de
margen a cada lado, y suprime los puntos de la otra mano. La captura de la
página dura ahora 5,5 segundos y el buffer guarda seis segundos, para incluir
el gesto completo en cámaras lentas. La sexta grabación se probó también con
solo sus primeros 5,5 segundos: se procesaron 42 de 42 imágenes y BERT sugirió
`drink` primero (52,8%). Esa probabilidad no es una nota de calidad.

Estos seis videos verifican un caso concreto. No miden exactitud general,
calibración de probabilidades ni errores de forma, orientación o velocidad.
La página ofrece además HELLO, WATER, EAT, PLEASE, THANK YOU y SORRY porque
sus glosas figuran en WLASL2000 y tienen demostraciones enlazadas. Todavía no
hay grabaciones etiquetadas de esas seis señas con esta cámara; su selección y
su reconocimiento técnico no establecen exactitud ni permiten una nota de
ejecución.
Las guías de la página enlazan al diccionario ASL de Handspeak: [DRINK](https://www.handspeak.com/word/0627/),
[HELLO](https://www.handspeak.com/word/1015/), [WATER](https://www.handspeak.com/word/2360/),
[EAT](https://www.handspeak.com/word/645/), [PLEASE](https://www.handspeak.com/word/1658/),
[THANK YOU](https://www.handspeak.com/word/2186/) y [SORRY](https://www.handspeak.com/word/2027/).
En particular, BERT aún omitió uno de los tres intentos etiquetados como
correctos, incluso tras corregir la inversión del video de WhatsApp. La sexta
grabación no es la misma secuencia de imágenes enviada por la página; falta
repetir el intento en vivo con la versión actual para confirmar la mejora con
esa cámara. Para un
veredicto de ejecución completo hacen falta ejemplos etiquetados de varias
personas y cámaras, errores de distintos tipos, revisión por personas fluidas
en ASL y una validación separada antes de ajustar umbrales o entrenar un
modelo específico. El proyecto menciona LSEC en su objetivo; WLASL está
entrenado para ASL y no valida señas LSEC.

## Instalación reproducible

Desde `backend/`, instale `requirements-openhands.txt` en `.venv-openhands` y
ejecute `./install_models.ps1`. Este invoca `install_bert.ps1`, que descarga el archivo de la versión
oficial `checkpoints_v1`, verifica SHA-256 del ZIP
`7bcb942d29b2c9f1d3426350eca0d5b16725e6df46e370db24e29b08125c4d09`
y del checkpoint
`4c5f0a606b76f32a47b132e50a199bc626dff38f5108b2cb4007be077e85e090`.
También verifica las etiquetas WLASL2000 y MediaPipe Holistic contra hashes
SHA-256 conocidos. Los archivos quedan bajo `backend/models/`, excluidos de Git.
