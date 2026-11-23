// Ejecutar con Bun desde el checkout. El argumento es el origen del API de laboratorio.
import { clienteLsec, frameLsec } from "./cliente-lsec";
import { evaluarLocal } from "./motor-lsec";
import { RecordedJsonlFrameSource } from "./recorded-jsonl-frame-source";
import type { Parametro } from "./visena-lsec.types";
import assert from "node:assert/strict";

const api = clienteLsec(process.argv[2] ?? "https://localhost");
const catalogo = await api.catalogo();
const activas = catalogo.referencias.filter(
  (r) => r.estado !== "pendiente_referencia",
);
assert.ok(activas.length, "El laboratorio requiere plantillas cargadas.");
let primeras = 0;
let segmentadas = 0;
let calificadas = 0;
let maximaDiferencia = 0;
const latencias: number[] = [];
for (const fila of activas) {
  const plantilla = await api.plantilla(fila.id);
  const { ancho, alto, frames: originales } = plantilla.captura;
  const frames = originales.map((f, i) =>
    frameLsec(
      {
        pose: f.pose,
        poseWorld: f.pose_world,
        leftHand: f.mano_izquierda,
        rightHand: f.mano_derecha,
        blendshapes: f.blendshapes_rostro,
        imageAspect: ancho / alto,
      },
      i,
      f.timestamp_ms,
    ),
  );
  const intento = new RecordedJsonlFrameSource(
    frames.map((f) => JSON.stringify(f)).join("\n"),
  ).intento(ancho, alto);
  const segmento = await api.segmentar(intento);
  if (segmento.estado === "detectado") segmentadas++;
  const toma = {
    ...intento,
    segmentacion: plantilla.captura.segmentacion,
    id_referencia: fila.id,
  };
  const inicio = performance.now();
  const remoto = await api.evaluar(toma);
  latencias.push(performance.now() - inicio);
  const local = evaluarLocal(plantilla, toma);
  assert.equal(remoto.similitud?.id_referencia, fila.id);
  assert.equal(remoto.similitud.puntaje, 100);
  assert.deepEqual(remoto.similitud, local.similitud);
  const dirigida = await api.evaluar(
    { ...intento, id_referencia: fila.id },
    undefined,
    true,
  );
  assert.equal(dirigida.similitud?.id_referencia, fila.id);
  assert.ok(
    dirigida.similitud.puntaje >= 0 && dirigida.similitud.puntaje <= 100,
  );
  calificadas++;
  assert.equal(remoto.estado, local.estado, fila.id);
  assert.notEqual(local.estado, "datos_insuficientes", fila.id);
  for (const nombre of Object.keys(local.parametros) as Parametro[]) {
    const a = local.parametros[nombre],
      b = remoto.parametros[nombre];
    assert.equal(a.estado, b.estado);
    if (a.desviacion !== null && b.desviacion !== null)
      maximaDiferencia = Math.max(
        maximaDiferencia,
        Math.abs(a.desviacion - b.desviacion),
      );
  }
  const ranking = await api.reconocer({
    ...intento,
    segmentacion: toma.segmentacion,
  });
  if (ranking.candidatas[0]?.id_referencia === fila.id) primeras++;
  assert.equal(ranking.similitud?.id_referencia, fila.id);
  assert.equal(ranking.similitud.puntaje, 100);
}
console.log(
  JSON.stringify({
    plantillas: activas.length,
    primeras,
    segmentadas,
    calificadas,
    maximaDiferencia,
    p95EvaluacionHttpMs: Math.round(
      latencias.sort((a, b) => a - b)[Math.ceil(0.95 * latencias.length) - 1],
    ),
  }),
);
assert.equal(primeras, activas.length);
assert.ok(maximaDiferencia <= 0.000002);
