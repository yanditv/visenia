/**
 * Servicio de Cámara y Flujo de Video - Viseña (RF-01)
 * Gestiona el acceso al dispositivo de captura con soporte para restricciones y manejo de errores.
 */

export interface CameraConfig {
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  width: 640,
  height: 480,
  fps: 30,
};

export class CameraService {
  private requestId = 0;
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
  }

  public async start(config: CameraConfig = DEFAULT_CAMERA_CONFIG): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        'La API navigator.mediaDevices.getUserMedia no está disponible en este navegador o contexto inseguro (requiere HTTPS).'
      );
    }

    this.stop();
    const requestId = this.requestId;

    const constraints: MediaStreamConstraints = {
      video: {
        width: { ideal: config.width },
        height: { ideal: config.height },
        frameRate: { ideal: config.fps, max: 60 },
        facingMode: 'user',
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== this.requestId) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Solicitud de cámara cancelada.');
      }
      this.stream = stream;
      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
      }
      return this.stream;
    } catch (err: unknown) {
      if (requestId === this.requestId) this.stop();
      const error = err as Error;
      if (error.name === 'NotAllowedError') {
        throw new Error('Permiso de acceso a la cámara denegado por el usuario.');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No se detectó ningún dispositivo de cámara en el sistema.');
      } else {
        throw new Error(`Error al inicializar la cámara: ${error.message}`);
      }
    }
  }

  public stop(): void {
    this.requestId++;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  public isRunning(): boolean {
    return this.stream !== null && this.stream.active;
  }
}
