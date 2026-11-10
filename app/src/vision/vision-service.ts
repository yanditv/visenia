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
  FaceLandmarker,
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
  1, 2, 98, 327, 152,
];

export class VisionService {
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private framingSince: number | null = null;
  private lastTimestamp: number | null = null;
  private previousHands: { left?: LandmarkPoint; right?: LandmarkPoint } = {};
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
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.3,
          minPosePresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        }),

        // 2. Detector de Manos (calibrado a 0.3 para evitar pérdida sobre ropa/pecho)
        HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        }),

        // 3. Detector de Rostro con extracción de Blendshapes (prosoponema)
        FaceLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: '/models/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        }),
      ]);

      const [rPose, rHand, rFace] = resultados;

      if (rPose.status === 'fulfilled') {
        this.poseLandmarker = rPose.value as PoseLandmarker;
        console.log('[VisionService] ✓ PoseLandmarker listo.');
      } else {
        console.error(
          '[VisionService] ✗ PoseLandmarker falló:',
          (rPose as PromiseRejectedResult).reason
        );
      }

      if (rHand.status === 'fulfilled') {
        this.handLandmarker = rHand.value as HandLandmarker;
        console.log('[VisionService] ✓ HandLandmarker listo.');
      } else {
        console.error(
          '[VisionService] ✗ HandLandmarker falló:',
          (rHand as PromiseRejectedResult).reason
        );
      }

      if (rFace.status === 'fulfilled') {
        this.faceLandmarker = rFace.value as FaceLandmarker;
        console.log('[VisionService] ✓ FaceLandmarker (Blendshapes) listo.');
      } else {
        console.error(
          '[VisionService] ✗ FaceLandmarker falló:',
          (rFace as PromiseRejectedResult).reason
        );
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

  public detect(
    video: HTMLVideoElement,
    timestamp: number
  ): {
    landmarks: HolisticFrameLandmarks;
    encuadreValido: boolean;
  } {
    if (!this.isReady || !video || video.readyState < 2) {
      this.resetTracking();
      return { landmarks: {}, encuadreValido: false };
    }
    if (this.lastTimestamp !== null && timestamp - this.lastTimestamp > 250) this.resetTracking();
    this.lastTimestamp = timestamp;

    const result: HolisticFrameLandmarks = {
      imageAspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1,
    };
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
          visibility: lm.visibility ?? 1.0,
        }));

        if (poseResult.worldLandmarks && poseResult.worldLandmarks.length > 0) {
          result.poseWorld = poseResult.worldLandmarks[0].map((wlm) => ({
            x: wlm.x,
            y: wlm.y,
            z: wlm.z,
            visibility: wlm.visibility ?? 1.0,
          }));
        }

        const nose = result.pose[0];
        const leftShoulder = result.pose[11];
        const rightShoulder = result.pose[12];

        if (
          nose &&
          leftShoulder &&
          rightShoulder &&
          nose.x > 0.15 &&
          nose.x < 0.85 &&
          nose.y > 0.1 &&
          nose.y < 0.85 &&
          leftShoulder.x > 0.1 &&
          rightShoulder.x < 0.9
        ) {
          encuadreValido = true;
        }
      }
    }

    // 2. Inferencia de Manos con resolución anatómica robusta de lateralidad
    if (this.handLandmarker) {
      const handResult = this.handLandmarker.detectForVideo(video, timestamp);
      if (handResult.landmarks && handResult.landmarks.length > 0) {
        const hands = handResult.landmarks.map((points, index) => ({
          points: points.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: 1 })),
          category: handResult.handedness[index]?.[0]?.categoryName,
          score: handResult.handedness[index]?.[0]?.score ?? 0,
        }));
        const aspect = result.imageAspect ?? 1;
        const cost = (hand: (typeof hands)[number], side: 'left' | 'right') => {
          const index = side === 'left' ? 15 : 16;
          const poseWrist = result.pose?.[index];
          const anchor =
            poseWrist && (poseWrist.visibility ?? 1) > 0.25 ? poseWrist : this.previousHands[side];
          if (anchor)
            return Math.hypot((hand.points[0].x - anchor.x) * aspect, hand.points[0].y - anchor.y);
          // Labels only break ties when body and temporal anchors are unavailable.
          const expected = side === 'left' ? 'Right' : 'Left';
          return hand.category === expected ? 1 - hand.score : 1 + hand.score;
        };
        if (hands.length >= 2) {
          const direct = cost(hands[0], 'left') + cost(hands[1], 'right');
          const crossed = cost(hands[0], 'right') + cost(hands[1], 'left');
          result.leftHand = hands[direct <= crossed ? 0 : 1].points;
          result.rightHand = hands[direct <= crossed ? 1 : 0].points;
        } else if (hands.length === 1) {
          if (cost(hands[0], 'left') <= cost(hands[0], 'right')) result.leftHand = hands[0].points;
          else result.rightHand = hands[0].points;
        }
        this.previousHands = { left: result.leftHand?.[0], right: result.rightHand?.[0] };
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
          return pt
            ? { x: pt.x, y: pt.y, z: pt.z, visibility: 1.0 }
            : { x: 0, y: 0, z: 0, visibility: 0 };
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

    const inside = (p: LandmarkPoint | undefined) =>
      p && (p.visibility ?? 1) > 0.5 && p.x > 0.05 && p.x < 0.95 && p.y > 0.05 && p.y < 0.95;
    encuadreValido =
      encuadreValido &&
      !!result.face?.length &&
      !!inside(result.leftHand?.[0]) &&
      !!inside(result.rightHand?.[0]) &&
      !!inside(result.pose?.[11]) &&
      !!inside(result.pose?.[12]);
    if (!encuadreValido) this.framingSince = null;
    else this.framingSince ??= timestamp;
    if (!result.leftHand && !result.rightHand) this.previousHands = {};
    return {
      landmarks: result,
      encuadreValido: encuadreValido && timestamp - (this.framingSince ?? timestamp) >= 1000,
    };
  }

  public getReadyStatus(): boolean {
    return this.isReady;
  }

  public resetTracking(): void {
    this.framingSince = null;
    this.lastTimestamp = null;
    this.previousHands = {};
  }
}
