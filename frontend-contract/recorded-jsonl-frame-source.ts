import type { FrameCaptura, Intento } from "./visena-lsec.types";

/** Reproduce una ejecución local. Cada línea contiene un FrameCaptura 1.1.0. */
export class RecordedJsonlFrameSource {
  constructor(private readonly contenido: string) {}

  *frames(): Generator<FrameCaptura> {
    let index = 0;
    let anterior = -1;
    let inicio = 0;
    for (const linea of this.contenido.split(/\r?\n/)) {
      if (!linea.trim()) continue;
      const frame = JSON.parse(linea) as FrameCaptura;
      if (
        !frame ||
        frame.frame_idx !== index ||
        !Number.isFinite(frame.timestamp_ms) ||
        frame.timestamp_ms < 0 ||
        frame.timestamp_ms <= anterior ||
        index >= 300
      ) {
        throw new Error(`Índice o tiempo inválido en el cuadro ${index}.`);
      }
      if (!index) inicio = frame.timestamp_ms;
      if (frame.timestamp_ms - inicio > 20000)
        throw new Error("La captura supera 20 segundos.");
      anterior = frame.timestamp_ms;
      index++;
      yield frame;
    }
    if (index < 4) throw new Error("Se necesitan al menos cuatro cuadros.");
  }

  intento(ancho: number, alto: number): Intento {
    return {
      schema_version: "1.1.0",
      ancho,
      alto,
      frames: Array.from(this.frames()),
    };
  }
}
