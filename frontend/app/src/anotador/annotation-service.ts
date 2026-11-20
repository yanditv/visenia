/**
 * Servicio de Anotación y Captura de Señas de Referencia (RF-36)
 *
 * Permite a los especialistas en Lengua de Señas:
 * 1. Grabar secuencias de landmarks temporales (Pose 2D/World, Manos 21pts, Blendshapes)
 * 2. Segmentar inicio y fin de la seña (frame_inicio_sena, frame_fin_sena)
 * 3. Definir los 5 parámetros formativos fonológicos (Stokoe / ERS 6.1)
 * 4. Exportar el archivo JSON estricto validable contra referencia.schema.json v1.1.0
 */
import { HolisticFrameLandmarks } from '../render/skeleton-renderer';
import * as referenceSchema from '../../../data/schemas/referencia.schema.json';

export interface FrameCapturaSchema {
  frame_idx: number;
  timestamp_ms: number;
  image_aspect?: number;
  pose?: Array<{ x: number; y: number; z: number; visibility?: number }>;
  pose_world?: Array<{ x: number; y: number; z: number; visibility?: number }>;
  mano_derecha?: Array<{ x: number; y: number; z: number }>;
  mano_izquierda?: Array<{ x: number; y: number; z: number }>;
  blendshapes_rostro?: Record<string, number>;
  vrm_pose_override?: Record<string, [number, number, number, number]> | null;
}

export interface ReferenciaSenaData {
  schema_version: '1.1.0';
  id: string;
  glosa: string;
  unidad_tematica: number;
  dificultad: 'facil' | 'intermedio' | 'avanzado';
  mano_dominante: 'derecha' | 'izquierda' | 'ambas';
  metadatos_grabacion: {
    fps: number;
    total_frames: number;
    duracion_ms: number;
    anotador: string;
    fecha_anotacion: string;
  };
  segmentacion: {
    frame_inicio_preparacion?: number;
    frame_inicio_sena: number;
    frame_fin_sena: number;
    frame_retorno?: number;
  };
  parametros_fonologicos: {
    queirema_configuracion: {
      codigo_forma: string;
      descripcion: string;
      tolerancia_grados: number;
    };
    kinema_orientacion: {
      vector_palma: [number, number, number];
      tolerancia_grados: number;
    };
    toponema_ubicacion: {
      zona_corporal:
        'neutro_espacio' | 'cabeza' | 'frente' | 'pecho' | 'barbilla' | 'hombro' | 'mano_base';
      tolerancia_radio: number;
    };
    kinesema_movimiento: {
      tipo_movimiento: 'rectilineo' | 'curvo' | 'circular' | 'ondulatorio' | 'estatico';
      repeticiones: number;
    };
    prosoponema_no_manual: {
      requerido: boolean;
      blendshapes_clave?: Record<string, number>;
    };
  };
  frames: FrameCapturaSchema[];
}

type Schema = {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
};

// Validate the keywords used by referencia.schema.json, then temporal/rig invariants.
function validateSchema(value: unknown, schema: Schema, path: string): void {
  if (schema.$ref) {
    const key = schema.$ref.split('/').pop()!;
    return validateSchema(value, (referenceSchema.$defs as Record<string, Schema>)[key], path);
  }
  const fail = () => {
    throw new Error(`Referencia inválida: ${path}`);
  };
  const types = schema.type ? [schema.type].flat() : [];
  if (
    types.length &&
    !types.some((type) => {
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object')
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      if (type === 'integer') return Number.isInteger(value);
      if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
      return typeof value === type;
    })
  )
    fail();
  if ('const' in schema && value !== schema.const) fail();
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    fail();
  if (
    typeof value === 'string' &&
    ((schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)) ||
      (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))))
  )
    fail();
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      fail();
    if (schema.items)
      value.forEach((item, i) => validateSchema(item, schema.items!, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in record))) fail();
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      if (child) validateSchema(item, child, `${path}.${key}`);
    }
  }
}

export function isLegacyDemoHand(hand: FrameCapturaSchema['mano_derecha']): boolean {
  return (
    !!hand &&
    hand.length === 21 &&
    hand.every(
      (p, i) =>
        Math.abs(p.x - hand[0].x - (i % 5) * 0.015) < 1e-7 &&
        Math.abs(p.y - hand[0].y - Math.floor(i / 5) * 0.02) < 1e-7
    )
  );
}

export function validateReference(value: unknown): asserts value is ReferenciaSenaData {
  validateSchema(value, referenceSchema, 'referencia');
  const ref = value as ReferenciaSenaData;
  const {
    frames,
    segmentacion: seg,
    metadatos_grabacion: meta,
    parametros_fonologicos: params,
  } = ref;
  const fail = (field: string) => {
    throw new Error(`Referencia inválida: ${ref.id}.${field}`);
  };
  if (!frames.length || meta.total_frames !== frames.length) fail('total_frames');
  const bounds = [
    seg.frame_inicio_preparacion ?? 0,
    seg.frame_inicio_sena,
    seg.frame_fin_sena,
    seg.frame_retorno ?? frames.length - 1,
  ];
  if (
    bounds.some(
      (n, i) => !Number.isInteger(n) || n < 0 || n >= frames.length || (i > 0 && n < bounds[i - 1])
    )
  )
    fail('segmentacion');
  frames.forEach((frame, i) => {
    if (frame.frame_idx !== i || (i > 0 && frame.timestamp_ms <= frames[i - 1].timestamp_ms))
      fail(`frames[${i}].tiempo`);
    const legacy = isLegacyDemoHand(frame.mano_derecha) || isLegacyDemoHand(frame.mano_izquierda);
    for (const key of ['pose', 'pose_world', 'mano_derecha', 'mano_izquierda'] as const) {
      const points = frame[key];
      const count = key.startsWith('mano') ? 21 : 33;
      if (points && points.length !== count && !(legacy && count === 33 && points.length === 17))
        fail(`frames[${i}].${key}`);
    }
    if (
      frame.image_aspect !== undefined &&
      (!Number.isFinite(frame.image_aspect) || frame.image_aspect <= 0)
    )
      fail('image_aspect');
    for (const q of Object.values(frame.vrm_pose_override ?? {})) {
      if (!q.some((n) => n !== 0)) fail('vrm_pose_override');
    }
    if (Object.values(frame.blendshapes_rostro ?? {}).some((n) => n < 0 || n > 1))
      fail('blendshapes_rostro');
  });
  const duration = frames[frames.length - 1].timestamp_ms - frames[0].timestamp_ms;
  // Legacy files round milliseconds; metadata fps is the measured average rate.
  if (
    Math.abs(meta.duracion_ms - duration) > 1 ||
    duration <= 0 ||
    Math.abs(meta.fps - ((frames.length - 1) * 1000) / duration) > Math.max(0.1, meta.fps * 0.05)
  )
    fail('duracion_ms/fps');
  if (!params.kinema_orientacion.vector_palma.some((n) => n !== 0)) fail('vector_palma');
  const facial = params.prosoponema_no_manual;
  if (
    (facial.requerido && !Object.keys(facial.blendshapes_clave ?? {}).length) ||
    Object.values(facial.blendshapes_clave ?? {}).some((n) => n < 0 || n > 1)
  )
    fail('blendshapes_clave');
}

export function validateCatalog(value: unknown): asserts value is ReferenciaSenaData[] {
  if (!Array.isArray(value)) throw new Error('El catálogo debe ser una lista de referencias.');
  const ids = new Set<string>();
  for (const ref of value) {
    validateReference(ref);
    if (ids.has(ref.id)) throw new Error(`Referencia duplicada: ${ref.id}`);
    ids.add(ref.id);
  }
}

export class AnnotationService {
  private isRecording: boolean = false;
  private frames: FrameCapturaSchema[] = [];
  private startTime: number = 0;
  private frameCount: number = 0;

  public startRecording(): void {
    this.isRecording = true;
    this.frames = [];
    this.frameCount = 0;
    this.startTime = performance.now();
  }

  public recordFrame(landmarks: HolisticFrameLandmarks): void {
    if (!this.isRecording) return;

    const timestamp_ms = Math.round(performance.now() - this.startTime);
    const frame: FrameCapturaSchema = {
      frame_idx: this.frameCount++,
      timestamp_ms,
      image_aspect: landmarks.imageAspect,
    };

    if (landmarks.pose && landmarks.pose.length > 0) {
      frame.pose = landmarks.pose.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
        visibility: Math.round((pt.visibility ?? 1.0) * 100) / 100,
      }));
    }

    if (landmarks.poseWorld && landmarks.poseWorld.length > 0) {
      frame.pose_world = landmarks.poseWorld.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
        visibility: Math.round((pt.visibility ?? 1.0) * 100) / 100,
      }));
    }

    if (landmarks.rightHand && landmarks.rightHand.length === 21) {
      frame.mano_derecha = landmarks.rightHand.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
      }));
    }

    if (landmarks.leftHand && landmarks.leftHand.length === 21) {
      frame.mano_izquierda = landmarks.leftHand.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
      }));
    }

    if (landmarks.blendshapes && Object.keys(landmarks.blendshapes).length > 0) {
      frame.blendshapes_rostro = { ...landmarks.blendshapes };
    }

    if (landmarks.vrmPoseOverride) {
      frame.vrm_pose_override = { ...landmarks.vrmPoseOverride };
    }

    this.frames.push(frame);
  }

  public stopRecording(): { totalFrames: number; durationMs: number } {
    this.isRecording = false;
    const durationMs = Math.round(performance.now() - this.startTime);
    return {
      totalFrames: this.frames.length,
      durationMs,
    };
  }

  public getRecordedFrames(): FrameCapturaSchema[] {
    return this.frames;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Genera el objeto de referencia completo que cumple con referencia.schema.json v1.1.0
   */
  public buildReferenceDocument(config: {
    glosa: string;
    unidadTematica: number;
    dificultad: 'facil' | 'intermedio' | 'avanzado';
    manoDominante: 'derecha' | 'izquierda' | 'ambas';
    anotador: string;
    frameInicioSena: number;
    frameFinSena: number;
    queiremaForma: string;
    queiremaDesc: string;
    kinemaPalma: [number, number, number];
    toponemaZona:
      'neutro_espacio' | 'cabeza' | 'frente' | 'pecho' | 'barbilla' | 'hombro' | 'mano_base';
    kinesemaTipo: 'rectilineo' | 'curvo' | 'circular' | 'ondulatorio' | 'estatico';
    kinesemaRepeticiones: number;
    prosoponemaRequerido: boolean;
    prosoponemaBlendshapes?: Record<string, number>;
    frames?: FrameCapturaSchema[];
  }): ReferenciaSenaData {
    const source = config.frames ?? this.frames;
    const start = config.frameInicioSena;
    const end = config.frameFinSena;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end >= source.length
    )
      throw new Error('La segmentación contiene índices inválidos.');
    const segment = source.slice(start, end + 1);
    if (segment.length < 2) throw new Error('Selecciona al menos dos cuadros de la seña.');
    const origin = segment[0].timestamp_ms;
    const framesToUse = segment.map((frame, index) => ({
      ...frame,
      frame_idx: index,
      timestamp_ms: frame.timestamp_ms - origin,
    }));
    const totalFrames = framesToUse.length;
    const duracionMs = framesToUse[totalFrames - 1].timestamp_ms;
    if (
      duracionMs <= 0 ||
      framesToUse.some(
        (f, i) =>
          !Number.isFinite(f.timestamp_ms) ||
          (i > 0 && f.timestamp_ms <= framesToUse[i - 1].timestamp_ms)
      )
    )
      throw new Error('La captura contiene tiempos inválidos.');
    const fps = ((totalFrames - 1) * 1000) / duracionMs;
    if (fps < 15)
      throw new Error(
        'La captura no alcanza 15 fps. Repite la toma para conservar su velocidad real.'
      );
    if (duracionMs < 100) throw new Error('La seña debe durar al menos 100 ms.');
    if (config.prosoponemaRequerido && !Object.keys(config.prosoponemaBlendshapes ?? {}).length)
      throw new Error('Define un objetivo facial explícito para la expresión requerida.');

    const cleanGlosa = config.glosa
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const id = `ref-${cleanGlosa || 'sena'}-${Date.now().toString().slice(-6)}`;

    const document: ReferenciaSenaData = {
      schema_version: '1.1.0',
      id,
      glosa: config.glosa.trim().toUpperCase(),
      unidad_tematica: config.unidadTematica,
      dificultad: config.dificultad,
      mano_dominante: config.manoDominante,
      metadatos_grabacion: {
        fps,
        total_frames: totalFrames,
        duracion_ms: duracionMs,
        anotador: config.anotador.trim() || 'Especialista LSE',
        fecha_anotacion: new Date().toISOString(),
      },
      segmentacion: {
        frame_inicio_preparacion: 0,
        frame_inicio_sena: 0,
        frame_fin_sena: totalFrames - 1,
        frame_retorno: totalFrames - 1,
      },
      parametros_fonologicos: {
        queirema_configuracion: {
          codigo_forma: config.queiremaForma.trim() || 'mano_plana',
          descripcion: config.queiremaDesc.trim() || 'Palma extendida con dedos unidos',
          tolerancia_grados: 20,
        },
        kinema_orientacion: {
          vector_palma: config.kinemaPalma,
          tolerancia_grados: 25,
        },
        toponema_ubicacion: {
          zona_corporal: config.toponemaZona,
          tolerancia_radio: 0.15,
        },
        kinesema_movimiento: {
          tipo_movimiento: config.kinesemaTipo,
          repeticiones: config.kinesemaRepeticiones,
        },
        prosoponema_no_manual: {
          requerido: config.prosoponemaRequerido,
          blendshapes_clave: { ...config.prosoponemaBlendshapes },
        },
      },
      frames: framesToUse,
    };
    validateReference(document);
    return document;
  }

  /**
   * Dispara la descarga del archivo JSON en el navegador del usuario.
   */
  public downloadJson(data: ReferenciaSenaData): void {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
