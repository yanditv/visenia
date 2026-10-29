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

export interface FrameCapturaSchema {
  frame_idx: number;
  timestamp_ms: number;
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
      zona_corporal: 'neutro_espacio' | 'cabeza' | 'frente' | 'pecho' | 'barbilla' | 'hombro' | 'mano_base';
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
      timestamp_ms
    };

    if (landmarks.pose && landmarks.pose.length > 0) {
      frame.pose = landmarks.pose.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
        visibility: Math.round((pt.visibility ?? 1.0) * 100) / 100
      }));
    }

    if (landmarks.poseWorld && landmarks.poseWorld.length > 0) {
      frame.pose_world = landmarks.poseWorld.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000,
        visibility: Math.round((pt.visibility ?? 1.0) * 100) / 100
      }));
    }

    if (landmarks.rightHand && landmarks.rightHand.length === 21) {
      frame.mano_derecha = landmarks.rightHand.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000
      }));
    }

    if (landmarks.leftHand && landmarks.leftHand.length === 21) {
      frame.mano_izquierda = landmarks.leftHand.map((pt) => ({
        x: Math.round(pt.x * 1000) / 1000,
        y: Math.round(pt.y * 1000) / 1000,
        z: Math.round((pt.z ?? 0) * 1000) / 1000
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
      durationMs
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
    toponemaZona: 'neutro_espacio' | 'cabeza' | 'frente' | 'pecho' | 'barbilla' | 'hombro' | 'mano_base';
    kinesemaTipo: 'rectilineo' | 'curvo' | 'circular' | 'ondulatorio' | 'estatico';
    kinesemaRepeticiones: number;
    prosoponemaRequerido: boolean;
    frames?: FrameCapturaSchema[];
  }): ReferenciaSenaData {
    const source = config.frames ?? this.frames;
    const start = Math.max(0, Math.min(source.length - 1, Math.trunc(config.frameInicioSena)));
    const end = Math.max(start, Math.min(source.length - 1, Math.trunc(config.frameFinSena)));
    const segment = source.slice(start, end + 1);
    if (segment.length < 2) throw new Error('Selecciona al menos dos cuadros de la seña.');
    const origin = segment[0].timestamp_ms;
    const framesToUse = segment.map((frame, index) => ({ ...frame, frame_idx: index, timestamp_ms: frame.timestamp_ms - origin }));
    const totalFrames = framesToUse.length;
    const duracionMs = framesToUse[totalFrames - 1].timestamp_ms;
    if (duracionMs <= 0 || framesToUse.some((f, i) => !Number.isFinite(f.timestamp_ms) || (i > 0 && f.timestamp_ms <= framesToUse[i - 1].timestamp_ms))) throw new Error('La captura contiene tiempos inválidos.');
    const fps = (totalFrames - 1) * 1000 / duracionMs;
    if (fps < 15) throw new Error('La captura no alcanza 15 fps. Repite la toma para conservar su velocidad real.');

    const cleanGlosa = config.glosa.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `ref-${cleanGlosa || 'sena'}-${Date.now().toString().slice(-6)}`;

    return {
      schema_version: '1.1.0',
      id,
      glosa: config.glosa.trim().toUpperCase(),
      unidad_tematica: config.unidadTematica,
      dificultad: config.dificultad,
      mano_dominante: config.manoDominante,
      metadatos_grabacion: {
        fps,
        total_frames: totalFrames,
        duracion_ms: Math.max(100, duracionMs),
        anotador: config.anotador.trim() || 'Especialista LSE',
        fecha_anotacion: new Date().toISOString()
      },
      segmentacion: {
        frame_inicio_preparacion: 0,
        frame_inicio_sena: 0,
        frame_fin_sena: totalFrames - 1,
        frame_retorno: totalFrames - 1
      },
      parametros_fonologicos: {
        queirema_configuracion: {
          codigo_forma: config.queiremaForma.trim() || 'mano_plana',
          descripcion: config.queiremaDesc.trim() || 'Palma extendida con dedos unidos',
          tolerancia_grados: 20
        },
        kinema_orientacion: {
          vector_palma: config.kinemaPalma,
          tolerancia_grados: 25
        },
        toponema_ubicacion: {
          zona_corporal: config.toponemaZona,
          tolerancia_radio: 0.15
        },
        kinesema_movimiento: {
          tipo_movimiento: config.kinesemaTipo,
          repeticiones: config.kinesemaRepeticiones
        },
        prosoponema_no_manual: {
          requerido: config.prosoponemaRequerido,
          blendshapes_clave: config.prosoponemaRequerido ? { jawOpen: 0.3 } : {}
        }
      },
      frames: framesToUse
    };
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
