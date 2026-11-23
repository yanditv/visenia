import type {
  CatalogoLsec,
  Feedback,
  Trayectoria,
  IntentoPractica,
  PracticaGuardada,
  Historial,
  Progreso,
  Evaluacion,
  FrameCaptura,
  IdReferencia,
  PlantillaLsec,
  Intento,
  IntentoEvaluacion,
  Reconocimiento,
  Segmentacion,
  Punto,
} from "./visena-lsec.types";

type PuntoVision = Omit<Punto, "z"> & { z?: number };
type PuntosVision = {
  imageAspect?: number;
  vrmPoseOverride?: FrameCaptura["vrm_pose_override"];
  pose?: PuntoVision[];
  poseWorld?: PuntoVision[];
  leftHand?: PuntoVision[];
  rightHand?: PuntoVision[];
  face?: PuntoVision[];
  blendshapes?: Record<string, number>;
};

export function frameLsec(
  landmarks: PuntosVision,
  frameIdx: number,
  timestampMs: number,
): FrameCaptura {
  const puntos = (track?: PuntoVision[]) =>
    track?.map((p) => ({ ...p, z: p.z ?? 0 }));
  return {
    frame_idx: frameIdx,
    timestamp_ms: timestampMs,
    image_aspect: landmarks.imageAspect,
    vrm_pose_override: landmarks.vrmPoseOverride,
    pose: puntos(landmarks.pose),
    pose_world: puntos(landmarks.poseWorld),
    mano_izquierda: puntos(landmarks.leftHand),
    mano_derecha: puntos(landmarks.rightHand),
    rostro: puntos(landmarks.face),
    blendshapes_rostro: landmarks.blendshapes,
  };
}

export function claveParticipante(): string {
  const nombre = "visenia-participant-key";
  let clave = localStorage.getItem(nombre);
  if (!clave || !/^[a-f0-9]{64}$/.test(clave)) {
    clave = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
    localStorage.setItem(nombre, clave);
  }
  return clave;
}

export function clienteLsec(origen = "") {
  const base = `${origen.replace(/\/$/, "")}/api/v1/lsec`;

  async function request<T>(
    path: string,
    signal?: AbortSignal,
    body?: object,
    privada = false,
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      signal: signal ?? AbortSignal.timeout(15000),
      headers: {
        ...(privada && { "X-Participant-Key": claveParticipante() }),
        ...(body && { "Content-Type": "application/json" }),
      },
      ...(body && {
        method: "POST",
        body: JSON.stringify(body),
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw Object.assign(
        new Error(`API LSEC respondió HTTP ${response.status}`),
        {
          status: response.status,
          detail: error?.detail,
        },
      );
    }
    return response.json() as Promise<T>;
  }

  return {
    trayectoria: () =>
      request<Trayectoria>("/trayectoria", undefined, undefined, true),
    estadoFeedback: () =>
      request<{ groq_disponible: boolean; estado: Feedback["estado"] }>(
        "/feedback/estado",
      ),
    feedback: (id: string, signal?: AbortSignal) =>
      request<Feedback>(
        "/feedback/" + encodeURIComponent(id),
        signal,
        {},
        true,
      ),
    practicar: (intento: IntentoPractica, signal?: AbortSignal) =>
      request<PracticaGuardada>("/practicas", signal, intento, true),
    historial: (offset = 0, signal?: AbortSignal) =>
      request<Historial>(
        "/practicas?limite=20&offset=" + offset,
        signal,
        undefined,
        true,
      ),
    progreso: (signal?: AbortSignal) =>
      request<Progreso>("/progreso", signal, undefined, true),
    exportar: async (formato: "csv" | "json") => {
      const r = await fetch(base + "/exportaciones?formato=" + formato, {
        headers: { "X-Participant-Key": claveParticipante() },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error("No se pudo exportar el historial.");
      return r.blob();
    },
    catalogo: (signal?: AbortSignal) =>
      request<CatalogoLsec>("/catalogo", signal),
    referenciasUrl: `${base}/referencias`,
    plantilla: (id: IdReferencia, signal?: AbortSignal) =>
      request<PlantillaLsec>(`/plantillas/${encodeURIComponent(id)}`, signal),
    reconocer: (intento: Intento, signal?: AbortSignal, segmentar = false) =>
      request<Reconocimiento>(
        segmentar ? "/reconocimientos?segmentar=true" : "/reconocimientos",
        signal,
        intento,
      ),
    segmentar: (intento: Intento, signal?: AbortSignal) =>
      request<{
        estado: "detectado" | "datos_insuficientes";
        segmentacion: Segmentacion | null;
        mano_observada: PlantillaLsec["mano_dominante"] | null;
      }>("/segmentaciones", signal, intento),
    evaluar: (
      intento: IntentoEvaluacion,
      signal?: AbortSignal,
      segmentar = false,
    ) =>
      request<Evaluacion>(
        segmentar ? "/evaluaciones?segmentar=true" : "/evaluaciones",
        signal,
        intento,
      ),
  };
}
