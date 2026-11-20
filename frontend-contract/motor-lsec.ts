import type {
  Distancia,
  Evaluacion,
  FrameCaptura,
  Intento,
  Parametro,
  PlantillaLsec,
  Punto,
  Zona,
} from "./visena-lsec.types";

type Lado = "derecha" | "izquierda";
type Captura = PlantillaLsec["captura"];
type Muestra = { t: number; valores: number[] };
const parametros = [
  "queirema_configuracion",
  "kinema_orientacion",
  "toponema_ubicacion",
  "kinesema_movimiento",
  "prosoponema_no_manual",
] as const;
const consejos = [
  "Revisa la configuración de los dedos.",
  "Revisa hacia dónde apunta la palma.",
  "Compara la altura y posición de la mano.",
  "Compara el recorrido de la mano.",
  "Compara la expresión del rostro.",
];
const redondear = (n: number, precision: number) =>
  Number(n.toFixed(precision));
const resta = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const norma = (v: number[]) => Math.hypot(...v);

function segmento(c: Captura) {
  const inicio = c.segmentacion?.frame_inicio_sena ?? 0;
  const fin = c.segmentacion?.frame_fin_sena ?? c.frames.length - 1;
  if (
    !Number.isInteger(inicio) ||
    !Number.isInteger(fin) ||
    inicio < 0 ||
    fin >= c.frames.length ||
    fin - inicio < 3 ||
    c.frames.length > 300 ||
    c.frames.some(
      (f, i) =>
        f.frame_idx !== i ||
        !Number.isFinite(f.timestamp_ms) ||
        f.timestamp_ms < 0 ||
        (i > 0 && f.timestamp_ms <= c.frames[i - 1].timestamp_ms),
    ) ||
    c.frames.at(-1)!.timestamp_ms - c.frames[0].timestamp_ms > 20000 ||
    ![c.ancho, c.alto].every((v) => Number.isInteger(v) && v >= 64 && v <= 4096)
  ) {
    throw new RangeError(
      "Dimensiones, segmento o tiempos de captura inválidos.",
    );
  }
  return c.frames.slice(inicio, fin + 1);
}

function hombros(f: FrameCaptura, c: Captura) {
  const a = f.pose?.[11],
    b = f.pose?.[12];
  if (!a || !b || Math.min(a.visibility ?? 1, b.visibility ?? 1) < 0.5) return;
  const escala = Math.hypot((a.x - b.x) * c.ancho, (a.y - b.y) * c.alto);
  if (escala >= 5) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, escala };
}

function manual(f: FrameCaptura, c: Captura, lado: Lado, indice: number) {
  const mano = f[`mano_${lado}`];
  if (mano?.length !== 21 || mano.some((p) => (p.visibility ?? 1) < 0.5))
    return;
  if (indice >= 2) {
    const h = hombros(f, c);
    if (h)
      return [
        ((mano[0].x - h.x) * c.ancho) / h.escala,
        ((mano[0].y - h.y) * c.alto) / h.escala,
      ];
    return;
  }
  const px = (p: Punto) => [p.x * c.ancho, p.y * c.alto, p.z * c.ancho];
  const puntos = mano.map(px);
  if (indice === 0) {
    const angulos = [];
    for (let base = 1; base < 21; base += 4) {
      for (let j = base; j < base + 3; j++) {
        const u = resta(puntos[j === base ? 0 : j - 1], puntos[j]);
        const v = resta(puntos[j + 1], puntos[j]);
        if (Math.min(norma(u), norma(v)) <= 1e-5) return;
        const cos =
          u.reduce((s, x, i) => s + x * v[i], 0) / (norma(u) * norma(v));
        angulos.push(
          Math.fround(Math.acos(Math.max(-1, Math.min(1, cos))) / Math.PI),
        );
      }
    }
    return angulos;
  }
  const u = resta(puntos[5], puntos[0]),
    v = resta(puntos[17], puntos[0]);
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const d = u.map((x, i) => (x + v[i]) / 2);
  if (
    norma(n) <= 1e-5 ||
    norma(d) <= 1e-5 ||
    norma(n) / (norma(u) * norma(v)) <= 0.05
  )
    return;
  return [
    ...n.map((x) => Math.fround(x / norma(n))),
    ...d.map((x) => Math.fround(x / norma(d))),
  ];
}

function pista(
  frames: FrameCaptura[],
  extraer: (f: FrameCaptura) => number[] | undefined,
  relativa: boolean,
) {
  const validas: Muestra[] = [];
  for (const frame of frames) {
    const valores = extraer(frame);
    if (valores?.length && valores.every(Number.isFinite))
      validas.push({ t: frame.timestamp_ms, valores });
  }
  if (
    validas.length < 4 ||
    validas.length < frames.length * 0.7 ||
    validas.some((s, i) => i && s.t - validas[i - 1].t > 350)
  )
    return;
  const a = validas[0],
    b = validas[validas.length - 1];
  if (
    a.t - frames[0].timestamp_ms > 350 ||
    frames[frames.length - 1].timestamp_ms - b.t > 350
  )
    return;
  let j = 1;
  const count = Math.min(36, validas.length);
  return Array.from({ length: count }, (_, i) => {
    const t = a.t + ((b.t - a.t) * i) / (count - 1);
    while (j < validas.length - 1 && validas[j].t < t) j++;
    const prev = validas[j - 1],
      next = validas[j];
    const factor = (t - prev.t) / (next.t - prev.t);
    return prev.valores.map(
      (x, k) =>
        x + factor * (next.valores[k] - x) - (relativa ? a.valores[k] : 0),
    );
  });
}

function dtw(a?: number[][], b?: number[][]) {
  if (!a || !b) return null;
  const n = a.length,
    m = b.length,
    banda = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * 0.2));
  const costos = new Float64Array((n + 1) * (m + 1)).fill(Infinity);
  const pasos = new Uint16Array(costos.length);
  costos[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(1, i - banda); j <= Math.min(m, i + banda); j++) {
      const k = i * (m + 1) + j,
        arriba = k - m - 1,
        izq = k - 1,
        diag = arriba - 1;
      let mejor = arriba;
      if (costos[izq] < costos[mejor]) mejor = izq;
      if (costos[diag] < costos[mejor]) mejor = diag;
      costos[k] = costos[mejor] + norma(resta(a[i - 1], b[j - 1]));
      pasos[k] = pasos[mejor] + 1;
    }
  }
  const fin = costos.length - 1;
  return redondear(
    redondear(costos[fin] / pasos[fin], 6) / Math.sqrt(a[0].length),
    6,
  );
}

/** Compara una captura en memoria. La plantilla se obtiene con clienteLsec().plantilla(id). */
export function evaluarLocal(
  plantilla: PlantillaLsec,
  intento: Intento,
): Evaluacion {
  const start = performance.now();
  if (intento.schema_version !== plantilla.schema_version)
    throw new Error("Versión incompatible.");
  const ref = segmento(plantilla.captura),
    user = segmento(intento);
  const mediciones = {} as Record<Parametro, Distancia>;
  const lados: Lado[] =
    plantilla.mano_dominante === "ambas"
      ? ["izquierda", "derecha"]
      : [plantilla.mano_dominante];
  for (const [i, nombre] of parametros.entries()) {
    if (i === 4) {
      const keys = plantilla.blendshapes_clave;
      const facial = (f: FrameCaptura) =>
        keys.map((key) => f.blendshapes_rostro?.[key] ?? NaN);
      const d = plantilla.rostro_requerido
        ? dtw(pista(ref, facial, false), pista(user, facial, false))
        : null;
      const opcional = plantilla.rostro_requerido === false;
      mediciones[nombre] = {
        estado: opcional
          ? "no_aplica"
          : d === null
            ? "datos_insuficientes"
            : "medido",
        desviacion: d,
        zonas_resaltar: opcional ? [] : ["rostro"],
      };
      continue;
    }
    const observados = lados.map((lado) =>
      plantilla.permite_alternancia_manual && lados.length === 1
        ? (intento.mano_practica ?? lado)
        : lado,
    );
    const distancias = lados.map((lado, k) => {
      const muestra = (f: FrameCaptura) => {
        const v = manual(f, plantilla.captura, lado, i);
        if (!v || observados[k] === lado || i === 0) return v;
        const signos = i === 1 ? [1, -1, -1, -1, 1, 1] : [-1, 1];
        return v.map((x, j) => x * signos[j]);
      };
      return dtw(
        pista(ref, muestra, i === 3),
        pista(user, (f) => manual(f, intento, observados[k], i), i === 3),
      );
    });
    const d = distancias.some((x) => x === null)
      ? null
      : Math.max(...(distancias as number[]));
    const zonas = observados
      .filter((_, k) => distancias[k] === d)
      .map<Zona>((lado) => (i === 0 ? `dedos_mano_${lado}` : `mano_${lado}`));
    mediciones[nombre] = {
      estado: d === null ? "datos_insuficientes" : "medido",
      desviacion: d,
      zonas_resaltar: zonas,
    };
  }
  const incompleto = parametros.some(
    (key, i) =>
      mediciones[key].estado === "datos_insuficientes" &&
      (i < 4 || plantilla.rostro_requerido === true),
  );
  const resultado: Evaluacion = {
    estado: incompleto ? "datos_insuficientes" : "sin_calibracion",
    version_catalogo: plantilla.version_catalogo,
    id_referencia: plantilla.id_referencia,
    parametros: mediciones,
    ejecucion: null,
    latencia_ms: performance.now() - start,
  };
  const cal = plantilla.calibracion;
  if (incompleto || !cal || plantilla.estado !== "publicada") return resultado;
  const evaluados = {} as NonNullable<
    Evaluacion["ejecucion"]
  >["resultado"]["parametros_evaluados"];
  const scores: number[] = [];
  for (const [i, key] of parametros.entries()) {
    const metrica = mediciones[key],
      d = metrica.desviacion;
    if (metrica.estado === "no_aplica") {
      evaluados[key] = {
        estado: "verde",
        desviacion: 0,
        zonas_resaltar: [],
        mensaje_feedback: "Sin requisito facial.",
      };
      continue;
    }
    const limites = cal.umbrales[key];
    if (d === null || !limites || limites.rojo <= limites.verde)
      throw new Error("Calibración incompleta.");
    const estado =
      d <= limites.verde ? "verde" : d >= limites.rojo ? "rojo" : "amarillo";
    scores.push(
      redondear(
        Math.min(
          100,
          Math.max(
            0,
            (100 * (limites.rojo - d)) / (limites.rojo - limites.verde),
          ),
        ),
        2,
      ),
    );
    evaluados[key] = {
      estado,
      desviacion: d,
      zonas_resaltar: estado === "verde" ? [] : metrica.zonas_resaltar,
      mensaje_feedback:
        estado === "verde" ? "Dentro del rango de referencia." : consejos[i],
    };
  }
  const total = redondear(scores.reduce((s, x) => s + x, 0) / scores.length, 2);
  const aprobado =
    total >= cal.puntaje_minimo &&
    parametros.every((key) => evaluados[key].estado !== "rojo");
  const inicio = user[0].timestamp_ms,
    fin = user[user.length - 1].timestamp_ms;
  const visibles = user.filter((f) => hombros(f, intento));
  resultado.estado = "evaluado";
  resultado.latencia_ms = redondear(performance.now() - start, 3);
  resultado.ejecucion = {
    schema_version: "1.1.0",
    id_ejecucion: crypto.randomUUID(),
    id_referencia: plantilla.id_referencia,
    timestamp_utc: new Date().toISOString(),
    modo: intento.modo ?? "practica_libre",
    frames_ejecucion: intento.frames,
    diagnostico_tecnico: {
      fps_promedio: redondear(((user.length - 1) * 1000) / (fin - inicio), 2),
      calidad_encuadre: redondear(visibles.length / user.length, 4),
      latencia_veredicto_ms: resultado.latencia_ms,
    },
    senales_segmentacion: {
      timestamp_encuadre_valido: visibles[0].timestamp_ms,
      timestamp_inicio_sena: inicio,
      timestamp_fin_sena: fin,
    },
    resultado: {
      puntaje_global: total,
      estrellas: aprobado ? (total >= 95 ? 3 : total >= 85 ? 2 : 1) : 0,
      veredicto_aprobado: aprobado,
      parametros_evaluados: evaluados,
    },
  };
  return resultado;
}
