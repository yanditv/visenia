/**
 * Servicio de Catálogo y Reproducción de Señas de Referencia (RF-07, RF-08)
 *
 * Administra el catálogo de señas fonológicas maestras y el reproductor del avatar 3D:
 * - Filtros por unidad temática, dificultad y búsqueda por glosa (RF-07)
 * - Control de reproducción interactivo: Play / Pausa / Scrubbing / Velocidad 1x y 0.5x (RF-08)
 * - Emisión de landmarks por fotograma para el solver Kalidokit
 */
import { Quaternion } from 'three/src/math/Quaternion.js';
import { clienteLsec } from '../../../../contracts/typescript/cliente-lsec';
import type { CatalogoLsec } from '../../../../contracts/typescript/visena-lsec.types';
import {
  ReferenciaSenaData,
  FrameCapturaSchema,
  validateCatalog,
  isLegacyDemoHand,
} from '../anotador/annotation-service';
import { HolisticFrameLandmarks, LandmarkPoint } from '../render/skeleton-renderer';

export type Nivel = ReferenciaSenaData | CatalogoLsec['referencias'][number];
type Guia = Pick<
  ReferenciaSenaData,
  'id' | 'glosa' | 'frames' | 'segmentacion' | 'mano_dominante'
> & {
  metadatos_grabacion: { fps: number };
  permite_alternancia_manual?: boolean;
  parametros_fonologicos?: ReferenciaSenaData['parametros_fonologicos'];
};

async function leerCatalogo(response: Response): Promise<ReferenciaSenaData[]> {
  if (!response.ok) throw new Error(`Error HTTP ${response.status} al cargar catálogo de señas.`);
  const rows: unknown = await response.json();
  validateCatalog(rows);
  return rows;
}

export class CatalogoPlayerService {
  private catalogo: Nivel[] = [];
  private nivel: Nivel | null = null;
  private selectedSena: Guia | null = null;
  private readonly api = clienteLsec();
  private isPlaying: boolean = false;
  private playbackSpeed: number = 1.0; // 1.0 = normal, 0.5 = lenta (RF-08)
  private currentFrameIndex: number = 0;
  private lastTickTime: number = 0;
  private playbackTimeMs = 0;
  private isLoaded: boolean = false;

  private async publishedCatalog(): Promise<ReferenciaSenaData[]> {
    const url = '/api/v1/lsec/referencias';
    const cache =
      typeof caches === 'undefined'
        ? undefined
        : await caches.open('lsec-referencias-publicadas-v1').catch(() => undefined);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
      const backup = cache ? response.clone() : undefined;
      const rows = await leerCatalogo(response);
      if (cache && backup) await cache.put(url, backup).catch(() => undefined);
      return rows;
    } catch {
      const backup = await cache?.match(url).catch(() => undefined);
      return backup ? leerCatalogo(backup).catch(() => []) : [];
    }
  }

  public async loadCatalog(url?: string): Promise<Nivel[]> {
    try {
      const [published, index] = url
        ? [[], undefined]
        : await Promise.all([
            this.publishedCatalog(),
            this.api.catalogo(AbortSignal.timeout(10000)).catch(() => undefined),
          ]);
      const entradas = Array.isArray(index?.referencias) ? index.referencias : [];
      const drafts = entradas.filter((r) => r?.estado === 'experimental');
      const alternables = new Set<string>(
        entradas
          .filter((r) => r?.estado === 'publicada' && r.permite_alternancia_manual)
          .map((r) => r.id)
      );
      let data = published;
      if (!data.length) {
        try {
          const res = await fetch(url ?? '/data/referencias-v1.json', {
            signal: AbortSignal.timeout(10000),
          });
          data = await leerCatalogo(res);
        } catch (error) {
          if (!drafts.length) throw error;
        }
      }
      const ids = new Set(drafts.map((r) => String(r.id)));
      const guias = data
        .filter((r) => !ids.has(r.id))
        .map((r) => (alternables.has(r.id) ? { ...r, permite_alternancia_manual: true } : r));
      this.catalogo = [...guias, ...drafts];
      this.nivel = null;
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
      this.nivel = null;
      this.selectedSena = null;
      this.isLoaded = false;
      this.isPlaying = false;
      console.error('[CatalogoPlayer] Error al cargar catálogo:', err);
      return [];
    }
  }

  public getCatalog(unit?: number): Nivel[] {
    return unit === undefined
      ? this.catalogo
      : this.catalogo.filter((s) => s.unidad_tematica === unit);
  }

  public selectUnit(unit: number): Nivel[] {
    this.pause();
    this.selectedSena = null;
    this.nivel = null;
    this.currentFrameIndex = 0;
    this.playbackTimeMs = 0;
    const references = this.getCatalog(unit);
    if (references.length) this.selectSena(references[0].id);
    return references;
  }

  public getIsLoaded(): boolean {
    return this.isLoaded;
  }

  public isDemo(sena: Nivel): boolean {
    return (
      'frames' in sena &&
      !!this.mapFrameToLandmarks(sena.frames[this.getSegmentBounds(sena)[0]]).isDemo
    );
  }

  public getSelectedSena(): Guia | null {
    return this.selectedSena;
  }

  public manoParaEncuadre(preferencia: string) {
    const guia = this.selectedSena;
    if (
      guia?.permite_alternancia_manual &&
      guia.mano_dominante !== 'ambas' &&
      (preferencia === 'izquierda' || preferencia === 'derecha')
    )
      return preferencia;
    return guia?.mano_dominante;
  }

  public getNivel() {
    return this.nivel;
  }

  public async cargarGuia() {
    const nivel = this.nivel;
    if (!nivel || 'frames' in nivel || this.selectedSena) return;
    const plantilla = await this.api.plantilla(nivel.id, AbortSignal.timeout(10000));
    if (this.nivel !== nivel) return;
    const { frames, segmentacion, ancho, alto } = plantilla.captura;
    const last = frames.length - 1;
    this.selectedSena = {
      id: nivel.id,
      glosa: nivel.glosa,
      mano_dominante: plantilla.mano_dominante,
      permite_alternancia_manual: plantilla.permite_alternancia_manual,
      frames: frames.map((f) => ({ ...f, image_aspect: f.image_aspect ?? ancho / alto })),
      segmentacion: segmentacion ?? { frame_inicio_sena: 0, frame_fin_sena: last },
      metadatos_grabacion: {
        fps: (last * 1000) / (frames[last].timestamp_ms - frames[0].timestamp_ms),
      },
    };
    this.seekFrame(this.selectedSena.segmentacion.frame_inicio_sena);
    this.lastTickTime = performance.now();
  }

  public selectSena(id: string): Nivel | null {
    const sena = this.catalogo.find((s) => s.id === id);
    if (sena) {
      this.nivel = sena;
      if (!('frames' in sena)) {
        this.isPlaying = false;
        this.selectedSena = null;
        return sena;
      }
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
  private getSegmentBounds(sena: Guia): [number, number] {
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
      isLegacyDemoHand(hand as FrameCapturaSchema['mano_derecha']);
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
