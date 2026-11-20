export type Punto = { x: number; y: number; z: number; visibility?: number };
export type FrameCaptura = {
  frame_idx: number;
  timestamp_ms: number;
  image_aspect?: number;
  pose?: Punto[];
  pose_world?: Punto[];
  mano_izquierda?: Punto[];
  mano_derecha?: Punto[];
  rostro?: Punto[];
  blendshapes_rostro?: Record<string, number>;
  vrm_pose_override?: Record<string, [number, number, number, number]> | null;
};

export type Segmentacion = {
  frame_inicio_preparacion?: number;
  frame_inicio_sena: number;
  frame_fin_sena: number;
  frame_retorno?: number;
};

export type Modo = "practica_libre" | "investigacion_pin" | "kiosco";
export type Intento = {
  schema_version: "1.1.0";
  ancho: number;
  alto: number;
  frames: FrameCaptura[];
  segmentacion?: Segmentacion;
  modo?: Modo;
  mano_practica?: "izquierda" | "derecha";
};

export type IdReferencia = `ref-${string}`;
export type IntentoEvaluacion = Intento & { id_referencia: IdReferencia };
export type PlantillaLsec = {
  schema_version: "1.1.0";
  version_catalogo: string;
  id_referencia: IdReferencia;
  glosa: string;
  unidad_tematica: number;
  fuente_url: string;
  estado: "experimental" | "publicada";
  mano_dominante: "izquierda" | "derecha" | "ambas";
  permite_alternancia_manual: boolean;
  intervalo_video_ms: [number, number] | null;
  captura: Pick<Intento, "ancho" | "alto" | "frames" | "segmentacion">;
  rostro_requerido: boolean | null;
  blendshapes_clave: string[];
  calibracion: {
    puntaje_minimo: number;
    umbrales: Partial<Record<Parametro, { verde: number; rojo: number }>>;
  } | null;
};
export type Parametro =
  | "queirema_configuracion"
  | "kinema_orientacion"
  | "toponema_ubicacion"
  | "kinesema_movimiento"
  | "prosoponema_no_manual";
export type Zona =
  "rostro" | `${"mano" | "dedos_mano"}_${"derecha" | "izquierda"}`;
export type Distancia = {
  estado: "medido" | "datos_insuficientes" | "no_aplica";
  desviacion: number | null;
  zonas_resaltar: Zona[];
};

export type Ejecucion = {
  schema_version: "1.1.0";
  id_ejecucion: string;
  id_referencia: IdReferencia;
  timestamp_utc: string;
  modo: Modo;
  diagnostico_tecnico: {
    fps_promedio: number;
    latencia_veredicto_ms: number;
    calidad_encuadre: number;
  };
  senales_segmentacion: {
    timestamp_encuadre_valido: number;
    timestamp_inicio_sena: number;
    timestamp_fin_sena: number;
  };
  resultado: {
    puntaje_global: number;
    estrellas: 0 | 1 | 2 | 3;
    veredicto_aprobado: boolean;
    parametros_evaluados: Record<
      Parametro,
      {
        estado: "verde" | "amarillo" | "rojo";
        desviacion: number;
        mensaje_feedback: string;
        zonas_resaltar: Zona[];
      }
    >;
  };
  frames_ejecucion: FrameCaptura[];
};

export type Evaluacion = {
  estado: "evaluado" | "sin_calibracion" | "datos_insuficientes";
  version_catalogo: string;
  id_referencia: IdReferencia;
  parametros: Record<Parametro, Distancia>;
  ejecucion: Ejecucion | null;
  latencia_ms: number;
};

export type Reconocimiento = {
  estado: "experimental" | "datos_insuficientes" | "sin_referencias";
  version_catalogo: string | null;
  candidatas: {
    id_referencia: IdReferencia;
    glosa: string;
    distancia: number;
  }[];
};

export type CatalogoLsec = {
  lengua: "LSEC";
  version_catalogo: string | null;
  referencias: {
    id: IdReferencia;
    glosa: string;
    unidad_tematica: number;
    fuente_url: string;
    video_url: string | null;
    estado: "pendiente_referencia" | "experimental" | "publicada";
    calibrada: boolean;
  }[];
};
