import type {
  CatalogoLsec,
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

export function clienteLsec(origen = "") {
  const base = `${origen.replace(/\/$/, "")}/api/v1/lsec`;

  async function request<T>(
    path: string,
    signal?: AbortSignal,
    body?: Intento,
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      signal,
      ...(body && {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    evaluar: (intento: IntentoEvaluacion, signal?: AbortSignal) =>
      request<Evaluacion>("/evaluaciones", signal, intento),
  };
}
