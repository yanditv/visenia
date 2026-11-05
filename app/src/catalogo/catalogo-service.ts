/**
 * Servicio de Catálogo y Reproducción de Señas de Referencia (RF-07, RF-08)
 *
 * Administra el catálogo de señas fonológicas maestras y el reproductor del avatar 3D:
 * - Filtros por unidad temática, dificultad y búsqueda por glosa (RF-07)
 * - Control de reproducción interactivo: Play / Pausa / Scrubbing / Velocidad 1x y 0.5x (RF-08)
 * - Emisión de landmarks por fotograma para el solver Kalidokit
 */
import { Quaternion } from 'three';
import { ReferenciaSenaData, FrameCapturaSchema } from '../anotador/annotation-service';
import { HolisticFrameLandmarks, LandmarkPoint } from '../render/skeleton-renderer';

export class CatalogoPlayerService {
  private catalogo: ReferenciaSenaData[] = [];
  private selectedSena: ReferenciaSenaData | null = null;
  private isPlaying: boolean = false;
  private playbackSpeed: number = 1.0; // 1.0 = normal, 0.5 = lenta (RF-08)
  private currentFrameIndex: number = 0;
  private lastTickTime: number = 0;
  private playbackTimeMs = 0;
  private isLoaded: boolean = false;

  public async loadCatalog(
    url: string = '/data/referencias-v1.json'
  ): Promise<ReferenciaSenaData[]> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Error HTTP ${res.status} al cargar catálogo de señas.`);
      }
      const data: unknown = await res.json();
      if (
        !Array.isArray(data) ||
        !data.every(
          (s) =>
            s &&
            typeof s.id === 'string' &&
            typeof s.glosa === 'string' &&
            s.parametros_fonologicos &&
            Array.isArray(s.frames) &&
            s.frames.length > 0 &&
            s.segmentacion &&
            s.metadatos_grabacion &&
            s.frames.every(
              (f: FrameCapturaSchema, i: number) =>
                Number.isFinite(f.timestamp_ms) &&
                (i === 0 || f.timestamp_ms > s.frames[i - 1].timestamp_ms)
            )
        )
      ) {
        throw new Error('El catálogo no contiene referencias con tiempos válidos.');
      }
      this.catalogo = data;
      this.selectedSena = null;
      this.isPlaying = false;
      this.isLoaded = true;

      if (this.catalogo.length > 0 && !this.selectedSena) {
        this.selectSena(this.catalogo[0].id);
      }

      console.log(`[CatalogoPlayer] ✓ ${this.catalogo.length} señas de referencia cargadas.`);
      return this.catalogo;
    } catch (err) {
      this.catalogo = [];
      this.selectedSena = null;
      this.isLoaded = false;
      this.isPlaying = false;
      console.error('[CatalogoPlayer] Error al cargar catálogo:', err);
      return [];
    }
  }

  public getCatalog(unit?: number): ReferenciaSenaData[] {
    return unit === undefined
      ? this.catalogo
      : this.catalogo.filter((s) => s.unidad_tematica === unit);
  }

  public selectUnit(unit: number): ReferenciaSenaData[] {
    this.pause();
    this.selectedSena = null;
    this.currentFrameIndex = 0;
    this.playbackTimeMs = 0;
    const references = this.getCatalog(unit);
    if (references.length) this.selectSena(references[0].id);
    return references;
  }

  public getIsLoaded(): boolean {
    return this.isLoaded;
  }

  public isDemo(sena: ReferenciaSenaData): boolean {
    return !!this.mapFrameToLandmarks(sena.frames[this.getSegmentBounds(sena)[0]]).isDemo;
  }

  public getSelectedSena(): ReferenciaSenaData | null {
    return this.selectedSena;
  }

  public selectSena(id: string): ReferenciaSenaData | null {
    const sena = this.catalogo.find((s) => s.id === id);
    if (sena) {
      this.selectedSena = sena;
      this.currentFrameIndex = this.getSegmentBounds(sena)[0];
      this.playbackTimeMs = sena.frames[this.currentFrameIndex].timestamp_ms;
      this.lastTickTime = performance.now();
      return sena;
    }
    return null;
  }

  public play(): void {
    if (!this.selectedSena) return;
    this.isPlaying = true;
    this.lastTickTime = performance.now();
  }

  public pause(): void {
    this.update(performance.now());
    this.isPlaying = false;
  }

  public togglePlay(): boolean {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    return this.isPlaying;
  }

  public setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.update(performance.now());
    this.playbackSpeed = Math.max(0.25, Math.min(2.0, speed));
  }

  public getSpeed(): number {
    return this.playbackSpeed;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentFrameIndex(): number {
    return this.currentFrameIndex;
  }

  public seekFrame(index: number): void {
    if (!this.selectedSena || !this.selectedSena.frames.length) return;
    if (!Number.isFinite(index)) return;
    const [start, end] = this.getSegmentBounds(this.selectedSena);
    this.currentFrameIndex = Math.max(start, Math.min(Math.trunc(index), end));
    this.playbackTimeMs = this.selectedSena.frames[this.currentFrameIndex].timestamp_ms;
    this.lastTickTime = performance.now();
  }

  /**
   * Avanza la reproducción según el tiempo delta y devuelve los landmarks del fotograma actual.
   */
  public update(timestamp: number): {
    landmarks: HolisticFrameLandmarks | null;
    frameIndex: number;
    totalFrames: number;
    hasLooped: boolean;
  } {
    if (!this.selectedSena || !this.selectedSena.frames.length) {
      return { landmarks: null, frameIndex: 0, totalFrames: 0, hasLooped: false };
    }

    const frames = this.selectedSena.frames;
    const totalFrames = frames.length;
    let hasLooped = false;

    const [start, end] = this.getSegmentBounds(this.selectedSena);
    const firstTime = frames[start].timestamp_ms;
    const finalDuration = frames[end + 1]
      ? frames[end + 1].timestamp_ms - frames[end].timestamp_ms
      : 1000 / (this.selectedSena.metadatos_grabacion.fps || 30);
    const duration = Math.max(1, frames[end].timestamp_ms + finalDuration - firstTime);
    if (this.isPlaying) {
      this.playbackTimeMs += Math.max(0, timestamp - this.lastTickTime) * this.playbackSpeed;
      if (this.playbackTimeMs >= firstTime + duration) {
        this.playbackTimeMs = firstTime + ((this.playbackTimeMs - firstTime) % duration);
        hasLooped = true;
      }
    }
    this.lastTickTime = timestamp;
    this.currentFrameIndex = start;
    while (
      this.currentFrameIndex < end &&
      frames[this.currentFrameIndex + 1].timestamp_ms <= this.playbackTimeMs
    )
      this.currentFrameIndex++;
    const currentFrame = frames[this.currentFrameIndex];
    const landmarks = this.mapFrameToLandmarks(currentFrame);
    const next = frames[Math.min(end, this.currentFrameIndex + 1)];
    const span = next.timestamp_ms - currentFrame.timestamp_ms;
    if (span > 0) {
      const alpha = Math.min(
        1,
        Math.max(0, (this.playbackTimeMs - currentFrame.timestamp_ms) / span)
      );
      const following = this.mapFrameToLandmarks(next);
      for (const key of ['pose', 'poseWorld', 'rightHand', 'leftHand'] as const) {
        const points = landmarks[key],
          nextPoints = following[key];
        if (points && nextPoints && points.length === nextPoints.length)
          landmarks[key] = points.map((p, i) => ({
            x: p.x + (nextPoints[i].x - p.x) * alpha,
            y: p.y + (nextPoints[i].y - p.y) * alpha,
            z: (p.z ?? 0) + ((nextPoints[i].z ?? 0) - (p.z ?? 0)) * alpha,
            visibility: Math.min(p.visibility ?? 1, nextPoints[i].visibility ?? 1),
          }));
      }
      if (landmarks.blendshapes && following.blendshapes) {
        for (const key of new Set([
          ...Object.keys(landmarks.blendshapes),
          ...Object.keys(following.blendshapes),
        ])) {
          const a = landmarks.blendshapes[key] ?? 0;
          landmarks.blendshapes[key] = a + ((following.blendshapes[key] ?? 0) - a) * alpha;
        }
      }
      if (landmarks.vrmPoseOverride && following.vrmPoseOverride) {
        for (const [name, q] of Object.entries(landmarks.vrmPoseOverride)) {
          const after = following.vrmPoseOverride[name];
          if (after)
            landmarks.vrmPoseOverride[name] = new Quaternion(...q)
              .normalize()
              .slerp(new Quaternion(...after).normalize(), alpha)
              .toArray() as [number, number, number, number];
        }
      }
    }

    return {
      landmarks,
      frameIndex: this.currentFrameIndex,
      totalFrames,
      hasLooped,
    };
  }

  /**
   * Mapea un FrameCapturaSchema a HolisticFrameLandmarks para el solver y renderer.
   */
  private getSegmentBounds(sena: ReferenciaSenaData): [number, number] {
    const last = sena.frames.length - 1;
    const start = Math.max(0, Math.min(last, Math.trunc(sena.segmentacion.frame_inicio_sena) || 0));
    const end = Math.max(start, Math.min(last, Math.trunc(sena.segmentacion.frame_fin_sena) || 0));
    return [start, end];
  }

  private mapFrameToLandmarks(frame: FrameCapturaSchema): HolisticFrameLandmarks {
    const result: HolisticFrameLandmarks = {};

    if (frame.pose) {
      result.pose = frame.pose.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 1.0,
      }));
    }

    if (frame.pose_world) {
      result.poseWorld = frame.pose_world.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 1.0,
      }));
    }

    if (frame.mano_derecha) {
      result.rightHand = frame.mano_derecha.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: 1.0,
      }));
    }

    if (frame.mano_izquierda) {
      result.leftHand = frame.mano_izquierda.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: 1.0,
      }));
    }

    if (frame.blendshapes_rostro) {
      result.blendshapes = { ...frame.blendshapes_rostro };
    }

    if (frame.vrm_pose_override) {
      result.vrmPoseOverride = { ...frame.vrm_pose_override };
    }

    const isGrid = (hand: LandmarkPoint[] | undefined) =>
      hand?.length === 21 &&
      hand.every(
        (p, i) =>
          Math.abs(p.x - hand[0].x - (i % 5) * 0.015) < 1e-7 &&
          Math.abs(p.y - hand[0].y - Math.floor(i / 5) * 0.02) < 1e-7
      );
    // Legacy demo frames contain a rectangular point grid, not MediaPipe hand anatomy.
    // Preserve the source JSON and use an open-hand preview, never feed the grid to the rig.
    result.isDemo = !!(isGrid(result.rightHand) || isGrid(result.leftHand));
    result.imageAspect = frame.image_aspect ?? 4 / 3;
    if (result.isDemo) {
      delete result.poseWorld;
      for (const key of ['rightHand', 'leftHand'] as const) {
        const hand = result[key];
        if (!hand || !isGrid(hand)) continue;
        const wrist = hand[0];
        const side = key === 'rightHand' ? -1 : 1;
        const at = (x: number, y: number): LandmarkPoint => ({
          x: wrist.x + x * side,
          y: wrist.y + y,
          z: wrist.z,
          visibility: 1,
        });
        result[key] = [
          at(0, 0),
          at(0.025, -0.025),
          at(0.05, -0.045),
          at(0.065, -0.06),
          at(0.08, -0.075),
        ];
        for (const [x, y] of [
          [0.035, -0.06],
          [0.01, -0.075],
          [-0.015, -0.07],
          [-0.035, -0.055],
        ]) {
          for (let joint = 0; joint < 4; joint++) result[key]!.push(at(x, y - joint * 0.025));
        }
      }
      // The legacy examples were authored in already-mirrored image coordinates.
      for (const key of ['pose', 'rightHand', 'leftHand'] as const) {
        if (result[key]) result[key] = result[key]!.map((p) => ({ ...p, x: 1 - p.x }));
      }
    }
    return result;
  }
}
