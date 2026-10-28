/**
 * Servicio de Inferencia en Tiempo Real con MediaPipe Tasks Vision (RF-01, RF-02)
 * Procesa frames de video de la cámara para detectar:
 * - Pose (2D normalizado y World 3D métrico)
 * - Manos (21 landmarks por mano, con umbrales calibrados para articulaciones sobre el pecho)
 * - Rostro (Blendshapes ARKit/VRM y landmarks de contorno facial)
 */
import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker
} from '@mediapipe/tasks-vision';
import { HolisticFrameLandmarks, LandmarkPoint } from '../render/skeleton-renderer';

// Índices clave del contorno facial (cejas, ojos, labios, contorno) para renderizado ligero
const KEY_FACE_LANDMARK_INDICES = [
  // Labios
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
  // Ceja izquierda
  70, 63, 105, 66, 107,
  // Ceja derecha
  336, 296, 334, 293, 300,
  // Ojo izquierdo y derecho
  33, 133, 159, 145, 362, 263, 386, 374,
  // Nariz y barbilla
  1, 2, 98, 327, 152
];

export class VisionService {
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private isInitializing: boolean = false;
  private isReady: boolean = false;

  public async init(): Promise<void> {
    if (this.isReady || this.isInitializing) return;
    this.isInitializing = true;

    try {
      const wasmFileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // 1. Detector de Pose corporal (landmarks 2D + world 3D en metros)
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

      // 2. Detector de Manos (calibrado a 0.3 para evitar que se pierdan sobre la ropa/pecho)
      this.handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: '/models/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3
      });

      // 3. Detector de Rostro con extracción de Blendshapes para VRoid/Blender (prosoponema)
      this.faceLandmarker = await FaceLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4
      });

      this.isReady = true;
      console.log('[VisionService] Modelos de Pose, Manos y Rostro (Blendshapes) activos con GPU.');
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

    // 1. Inferencia de Pose
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

        if (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0) {
          result.poseWorld = poseResult.worldLandmarks[0].map((wlm) => ({
            x: wlm.x,
            y: wlm.y,
            z: wlm.z,
            visibility: wlm.visibility ?? 1.0
          }));
        }

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

    // 2. Inferencia de Manos (con soporte para pecho / contrastes bajos)
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

    // 3. Inferencia de Rostro y Blendshapes (Prosoponema)
    if (this.faceLandmarker) {
      const faceResult = this.faceLandmarker.detectForVideo(video, timestamp);
      if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
        const allFacePoints = faceResult.faceLandmarks[0];

        // Mapear solo puntos clave de contorno facial para el canvas
        result.face = KEY_FACE_LANDMARK_INDICES.map((idx) => {
          const pt = allFacePoints[idx];
          return pt ? { x: pt.x, y: pt.y, z: pt.z, visibility: 1.0 } : { x: 0, y: 0, z: 0, visibility: 0 };
        });

        // Extraer coeficientes de Blendshapes (ARKit / VRoid / Blender)
        if (faceResult.faceBlendshapes && faceResult.faceBlendshapes.length > 0) {
          const blendshapesObj: Record<string, number> = {};
          faceResult.faceBlendshapes[0].categories.forEach((cat) => {
            blendshapesObj[cat.categoryName] = Math.round(cat.score * 1000) / 1000;
          });
          result.blendshapes = blendshapesObj;
        }
      }
    }

    return { landmarks: result, encuadreValido };
  }

  public getReadyStatus(): boolean {
    return this.isReady;
  }
}
