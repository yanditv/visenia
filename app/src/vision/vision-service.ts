/**
 * Servicio de Inferencia en Tiempo Real con MediaPipe Tasks Vision (RF-01, RF-02)
 * Procesa frames de video de la cámara para detectar Pose (2D y World 3D métrico) y Manos (21 landmarks).
 */
import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker
} from '@mediapipe/tasks-vision';
import { HolisticFrameLandmarks, LandmarkPoint } from '../render/skeleton-renderer';

export class VisionService {
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private isInitializing: boolean = false;
  private isReady: boolean = false;

  public async init(): Promise<void> {
    if (this.isReady || this.isInitializing) return;
    this.isInitializing = true;

    try {
      const wasmFileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // 1. Inicializar detector de Pose corporal (genera landmarks normalizados y worldLandmarks métricos en 3D)
      this.poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: '/models/pose_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      // 2. Inicializar detector de Manos detalladas (21 landmarks por mano)
      this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.isReady = true;
      console.log('[VisionService] Modelos de Pose (2D/World) y Manos cargados con éxito.');
    } catch (err) {
      console.error('[VisionService] Error al inicializar MediaPipe:', err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  public detect(video: HTMLVideoElement, timestamp: number): {
    landmarks: HolisticFrameLandmarks;
    encuadreValido: boolean;
  } {
    if (!this.isReady || !video || video.readyState < 2) {
      return { landmarks: {}, encuadreValido: false };
    }

    const result: HolisticFrameLandmarks = {};
    let encuadreValido = false;

    // 1. Inferencia de Pose (Normalizada y World 3D métrica para VRM)
    if (this.poseLandmarker) {
      const poseResult = this.poseLandmarker.detectForVideo(video, timestamp);
      if (poseResult.landmarks && poseResult.landmarks.length > 0) {
        const pLandmarks = poseResult.landmarks[0];
        result.pose = pLandmarks.map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
          visibility: lm.visibility ?? 1.0
        }));

        // pose_world (en metros, origen en centro de cadera) para retargeting VRM / Kalidokit
        if (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0) {
          result.poseWorld = poseResult.worldLandmarks[0].map((wlm) => ({
            x: wlm.x,
            y: wlm.y,
            z: wlm.z,
            visibility: wlm.visibility ?? 1.0
          }));
        }

        // Validación de encuadre básico:
        const nose = result.pose[0];
        const leftShoulder = result.pose[11];
        const rightShoulder = result.pose[12];

        if (
          nose && leftShoulder && rightShoulder &&
          nose.x > 0.15 && nose.x < 0.85 &&
          nose.y > 0.10 && nose.y < 0.85 &&
          leftShoulder.x > 0.10 && rightShoulder.x < 0.90
        ) {
          encuadreValido = true;
        }
      }
    }

    // 2. Inferencia de Manos
    if (this.handLandmarker) {
      const handResult = this.handLandmarker.detectForVideo(video, timestamp);
      if (handResult.landmarks && handResult.landmarks.length > 0) {
        handResult.landmarks.forEach((handPoints, idx) => {
          const handedness = handResult.handedness[idx]?.[0]?.categoryName;
          const mappedPoints: LandmarkPoint[] = handPoints.map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: 1.0
          }));

          if (handedness === 'Left') {
            result.leftHand = mappedPoints;
          } else {
            result.rightHand = mappedPoints;
          }
        });
      }
    }

    return { landmarks: result, encuadreValido };
  }

  public getReadyStatus(): boolean {
    return this.isReady;
  }
}
