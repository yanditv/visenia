/**
 * Servicio de Catálogo y Reproducción de Señas de Referencia (RF-07, RF-08)
 *
 * Administra el catálogo de señas fonológicas maestras y el reproductor del avatar 3D:
 * - Filtros por unidad temática, dificultad y búsqueda por glosa (RF-07)
 * - Control de reproducción interactivo: Play / Pausa / Scrubbing / Velocidad 1x y 0.5x (RF-08)
 * - Emisión de landmarks por fotograma para el solver Kalidokit
 */
import { ReferenciaSenaData, FrameCapturaSchema } from '../anotador/annotation-service';
import { HolisticFrameLandmarks } from '../render/skeleton-renderer';

export class CatalogoPlayerService {
  private catalogo: ReferenciaSenaData[] = [];
  private selectedSena: ReferenciaSenaData | null = null;
  private isPlaying: boolean = false;
  private playbackSpeed: number = 1.0; // 1.0 = normal, 0.5 = lenta (RF-08)
  private currentFrameIndex: number = 0;
  private lastTickTime: number = 0;
  private isLoaded: boolean = false;

  public async loadCatalog(url: string = '/data/referencias-v1.json'): Promise<ReferenciaSenaData[]> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Error HTTP ${res.status} al cargar catálogo de señas.`);
      }
      this.catalogo = await res.json();
      this.isLoaded = true;

      if (this.catalogo.length > 0 && !this.selectedSena) {
        this.selectSena(this.catalogo[0].id);
      }

      console.log(`[CatalogoPlayer] ✓ ${this.catalogo.length} señas de referencia cargadas.`);
      return this.catalogo;
    } catch (err) {
      console.error('[CatalogoPlayer] Error al cargar catálogo:', err);
      return [];
    }
  }

  public getCatalog(): ReferenciaSenaData[] {
    return this.catalogo;
  }

  public getIsLoaded(): boolean {
    return this.isLoaded;
  }

  public getSelectedSena(): ReferenciaSenaData | null {
    return this.selectedSena;
  }

  public selectSena(id: string): ReferenciaSenaData | null {
    const sena = this.catalogo.find((s) => s.id === id);
    if (sena) {
      this.selectedSena = sena;
      this.currentFrameIndex = 0;
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
    this.currentFrameIndex = Math.max(0, Math.min(index, this.selectedSena.frames.length - 1));
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

    if (this.isPlaying) {
      const elapsed = timestamp - this.lastTickTime;
      const targetFps = this.selectedSena.metadatos_grabacion.fps || 30;
      const frameDurationMs = (1000 / targetFps) / this.playbackSpeed;

      if (elapsed >= frameDurationMs) {
        const framesToAdvance = Math.floor(elapsed / frameDurationMs);
        this.currentFrameIndex += framesToAdvance;
        this.lastTickTime = timestamp - (elapsed % frameDurationMs);

        if (this.currentFrameIndex >= totalFrames) {
          this.currentFrameIndex = 0; // Reproducción continua en bucle
          hasLooped = true;
        }
      }
    }

    const currentFrame = frames[this.currentFrameIndex] || frames[0];
    const landmarks = this.mapFrameToLandmarks(currentFrame);

    return {
      landmarks,
      frameIndex: this.currentFrameIndex,
      totalFrames,
      hasLooped
    };
  }

  /**
   * Mapea un FrameCapturaSchema a HolisticFrameLandmarks para el solver y renderer.
   */
  private mapFrameToLandmarks(frame: FrameCapturaSchema): HolisticFrameLandmarks {
    const result: HolisticFrameLandmarks = {};

    if (frame.pose) {
      result.pose = frame.pose.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 1.0
      }));
    }

    if (frame.pose_world) {
      result.poseWorld = frame.pose_world.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 1.0
      }));
    }

    if (frame.mano_derecha) {
      result.rightHand = frame.mano_derecha.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: 1.0
      }));
    }

    if (frame.mano_izquierda) {
      result.leftHand = frame.mano_izquierda.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: 1.0
      }));
    }

    if (frame.blendshapes_rostro) {
      result.blendshapes = { ...frame.blendshapes_rostro };
    }

    if (frame.vrm_pose_override) {
      result.vrmPoseOverride = { ...frame.vrm_pose_override };
    }

    return result;
  }
}
