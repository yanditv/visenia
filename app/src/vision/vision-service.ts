/**
 * Servicio de Inferencia en Tiempo Real con MediaPipe Tasks Vision (RF-01, RF-02)
 * Procesa frames de video de la cámara para detectar:
 * - Pose (2D normalizado y World 3D métrico)
 * - Manos (21 landmarks por mano, con resolución anatómica de lateralidad por proximidad de muñecas)
 * - Rostro (Blendshapes ARKit/VRM y landmarks de contorno facial)
 *
 * Carga robusta: cada modelo se inicializa de forma independiente con Promise.allSettled.
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

      // Carga independiente: un modelo fallido no impide que los demás funcionen
      const resultados = await Promise.allSettled([
        // 1. Detector de Pose corporal (landmarks 2D + world 3D en metros)
        // Umbral calibrado a 0.3 para seguimiento continuo en planos medios/busto sin perder articulaciones
        PoseLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.3,
          minPosePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3
        }),

        // 2. Detector de Manos (calibrado a 0.3 para evitar pérdida sobre ropa/pecho)
        HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3
        }),

        // 3. Detector de Rostro con extracción de Blendshapes (prosoponema)
        FaceLandmarker.createFromOptions(wasmFileset, {
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
        })
      ]);

      const [rPose, rHand, rFace] = resultados;

      if (rPose.status === 'fulfilled') {
        this.poseLandmarker = rPose.value as PoseLandmarker;
        console.log('[VisionService] ✓ PoseLandmarker listo.');
      } else {
        console.error('[VisionService] ✗ PoseLandmarker falló:', (rPose as PromiseRejectedResult).reason);
      }

      if (rHand.status === 'fulfilled') {
        this.handLandmarker = rHand.value as HandLandmarker;
        console.log('[VisionService] ✓ HandLandmarker listo.');
      } else {
        console.error('[VisionService] ✗ HandLandmarker falló:', (rHand as PromiseRejectedResult).reason);
      }

      if (rFace.status === 'fulfilled') {
        this.faceLandmarker = rFace.value as FaceLandmarker;
        console.log('[VisionService] ✓ FaceLandmarker (Blendshapes) listo.');
      } else {
        console.error('[VisionService] ✗ FaceLandmarker falló:', (rFace as PromiseRejectedResult).reason);
      }

      if (this.poseLandmarker && this.handLandmarker) {
        this.isReady = true;
        const rostroEstado = this.faceLandmarker
          ? 'Rostro+Blendshapes activos'
          : 'Rostro NO disponible (solo Pose+Manos)';
        console.log(`[VisionService] Servicio activo con GPU. ${rostroEstado}.`);
      } else {
        throw new Error(
          'Modelos mínimos (Pose/Manos) no disponibles. Revisa los archivos .task en /public/models/.'
        );
      }
    } catch (err) {
      console.error('[VisionService] Error crítico al inicializar MediaPipe:', err);
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

    // 2. Inferencia de Manos con resolución anatómica robusta de lateralidad
    if (this.handLandmarker) {
      const handResult = this.handLandmarker.detectForVideo(video, timestamp);
      if (handResult.landmarks && handResult.landmarks.length > 0) {
        // En una cámara web frontal no reflejada en el sensor (unmirrored raw buffer):
        // MediaPipe asume 'selfie' por defecto, por lo que:
        // - categoryName === 'Left' corresponde a la mano DERECHA anatómica del usuario.
        // - categoryName === 'Right' corresponde a la mano IZQUIERDA anatómica del usuario.
        // Además, en el espacio del sensor, el hombro derecho (pose[12]) tiene menor X que el hombro izquierdo (pose[11]).
        const xCenter = (result.pose?.[11]?.x && result.pose?.[12]?.x)
          ? (result.pose[11].x + result.pose[12].x) / 2
          : 0.5;

        const detectedHands = handResult.landmarks.map((handPoints, idx) => {
          const mappedPoints: LandmarkPoint[] = handPoints.map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: 1.0
          }));
          const category = handResult.handedness[idx]?.[0]?.categoryName ?? '';
          const score = handResult.handedness[idx]?.[0]?.score ?? 0;
          const wristX = mappedPoints[0]?.x ?? 0.5;
          return { points: mappedPoints, category, score, wristX };
        });

        if (detectedHands.length === 1) {
          const h = detectedHands[0];
          // Si MediaPipe clasifica 'Left', es la mano derecha del usuario.
          // Si la clasificación no es concluyente, corroborar si la muñeca está en la mitad derecha del cuerpo (x < xCenter).
          const isRight = h.category === 'Left' || (h.category !== 'Right' && h.wristX < xCenter);
          if (isRight) {
            result.rightHand = h.points;
          } else {
            result.leftHand = h.points;
          }
        } else if (detectedHands.length >= 2) {
          // Desempatar dos manos para evitar colisiones:
          const candRight = detectedHands.find((h) => h.category === 'Left');
          const candLeft = detectedHands.find((h) => h.category === 'Right');

          if (candRight && candLeft) {
            result.rightHand = candRight.points;
            result.leftHand = candLeft.points;
          } else {
            // Si ambas tuvieron la misma etiqueta, ordenar por posición espacial (menor X es lado derecho del usuario)
            detectedHands.sort((a, b) => a.wristX - b.wristX);
            result.rightHand = detectedHands[0].points;
            result.leftHand = detectedHands[1].points;
          }
        }
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
