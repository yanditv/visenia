# Compatibilidad del checkpoint ASL

Esta comprobación corresponde al BiLSTM histórico. El WebSocket de cámara usa
ahora BERT; consulte la [evaluación del cambio](model-evaluation.md).

La reconstrucción local se contrastó con las clases originales de AI4Bharat/OpenHands en el commit `975b08807c40579708093a03918b4679a91a07e6`:

- [RNNClassifier](https://github.com/AI4Bharat/OpenHands/blob/975b08807c40579708093a03918b4679a91a07e6/openhands/models/decoder/rnn.py)
- [AttentionBlock](https://github.com/AI4Bharat/OpenHands/blob/975b08807c40579708093a03918b4679a91a07e6/openhands/models/decoder/utils.py)
- [PoseFlattener](https://github.com/AI4Bharat/OpenHands/blob/975b08807c40579708093a03918b4679a91a07e6/openhands/models/encoder/graph/pose_flattener.py)

El decoder original deja `batch_first=False`, aunque el encoder produce `(B, T, F)`. La integración local lo había cambiado a `True`. Ese cambio altera la interpretación de los pesos sin cambiar sus dimensiones, por lo que `load_state_dict(strict=True)` no detectaba la incompatibilidad. Se restauró el comportamiento original. No se entrenó ni sustituyó el checkpoint.

La selección de 27 puntos y la normalización por centro y distancia media de hombros corresponden al pipeline configurado. Las etiquetas se ordenan alfabéticamente como en `WLASLDataset`.

## Comprobación reproducible

`backend/tests/fixtures/openhands-upstream.npz` contiene tres entradas sintéticas y sus logits completos calculados con las clases originales y el checkpoint local. Incluye lotes de uno y dos elementos y distintas longitudes. El JSON adjunto identifica los hashes del checkpoint y de los archivos fuente. No contiene capturas de usuarios.

La prueba `test_openhands_compatibility.py` compara la reconstrucción local con esos resultados usando el entorno `.venv-openhands`. En la ejecución de comprobación, la diferencia máxima fue cero; la versión anterior difería hasta 25,13 unidades de logits en la primera entrada.

Para regenerar los vectores desde las fuentes originales verificadas:

```powershell
# Desde backend/
.\.venv-openhands\Scripts\python.exe tests/generate_openhands_fixture.py
```

## Alcance

La coincidencia numérica demuestra compatibilidad con la implementación original. No mide precisión en cámara ni demuestra que una seña del usuario sea correcta o incorrecta. La arquitectura histórica conserva sus particularidades; corregir su diseño y mantener los mismos pesos no garantiza conservar lo aprendido.

No se dispone de una evaluación de precisión con un conjunto ASL etiquetado representativo de esta cámara. El reconocimiento sigue siendo experimental. Una captura con cobertura completa demuestra que se detectaron puntos; no valida los detalles de la seña. Cuando la predicción difiere de la glosa seleccionada, el feedback debe expresar esa incertidumbre. Groq recibe métricas y predicciones, no observa el video.

En una prueba local con una grabación de práctica de `drink`, OpenHands asignó otras glosas aun cuando se observaba una mano acercándose a la boca. Probar segmentos temporales, aislar la mano activa e invertir la orientación no recuperó `drink`. La grabación no se incorpora al repositorio. Esta prueba muestra una limitación de generalización del checkpoint en cámara; una probabilidad muy alta para otra glosa tampoco confirma esa glosa. Para usar el modelo como verificador de ejecución hace falta evaluar y ajustar con grabaciones etiquetadas de personas y cámaras distintas.
