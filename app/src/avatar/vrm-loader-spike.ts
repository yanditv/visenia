/**
 * Carga y control del Avatar VRM con Three.js y Kalidokit (RF-42, ADR-002)
 *
 * Sprint 1: Spike técnico de animación en tiempo real con Kalidokit.
 * Mapea:
 * - Pose superior (torso, hombros, codos, muñecas) desde pose_world + pose 2D
 * - Dedos (21 landmarks por mano -> 15 articulaciones VRM) y orientación de muñeca (HandSolver)
 * - Blendshapes faciales para expresiones prosoponémicas
 * - Prioridad para vrm_pose_override (ADR-002)
 *
 * Dependencias: three, @pixiv/three-vrm, kalidokit
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import { Pose as KalidoPose, Hand as KalidoHand } from 'kalidokit';
import { HolisticFrameLandmarks } from '../render/skeleton-renderer';

/** Ruta pública del modelo VRM del proyecto */
export const VRM_MODEL_URL = '/models/visenia.vrm';

export interface VrmAvatarConfig {
  /** Contenedor HTML donde se montará el canvas Three.js */
  container: HTMLElement;
}

// Mapeo de articulaciones de mano derecha a huesos VRM humanoid
const RIGHT_FINGER_MAPPINGS: Array<{ vrmBone: VRMHumanBoneName; rigKey: string }> = [
  { vrmBone: VRMHumanBoneName.RightThumbMetacarpal, rigKey: 'RightThumbProximal' },
  { vrmBone: VRMHumanBoneName.RightThumbProximal, rigKey: 'RightThumbIntermediate' },
  { vrmBone: VRMHumanBoneName.RightThumbDistal, rigKey: 'RightThumbDistal' },
  { vrmBone: VRMHumanBoneName.RightIndexProximal, rigKey: 'RightIndexProximal' },
  { vrmBone: VRMHumanBoneName.RightIndexIntermediate, rigKey: 'RightIndexIntermediate' },
  { vrmBone: VRMHumanBoneName.RightIndexDistal, rigKey: 'RightIndexDistal' },
  { vrmBone: VRMHumanBoneName.RightMiddleProximal, rigKey: 'RightMiddleProximal' },
  { vrmBone: VRMHumanBoneName.RightMiddleIntermediate, rigKey: 'RightMiddleIntermediate' },
  { vrmBone: VRMHumanBoneName.RightMiddleDistal, rigKey: 'RightMiddleDistal' },
  { vrmBone: VRMHumanBoneName.RightRingProximal, rigKey: 'RightRingProximal' },
  { vrmBone: VRMHumanBoneName.RightRingIntermediate, rigKey: 'RightRingIntermediate' },
  { vrmBone: VRMHumanBoneName.RightRingDistal, rigKey: 'RightRingDistal' },
  { vrmBone: VRMHumanBoneName.RightLittleProximal, rigKey: 'RightLittleProximal' },
  { vrmBone: VRMHumanBoneName.RightLittleIntermediate, rigKey: 'RightLittleIntermediate' },
  { vrmBone: VRMHumanBoneName.RightLittleDistal, rigKey: 'RightLittleDistal' }
];

// Mapeo de articulaciones de mano izquierda a huesos VRM humanoid
const LEFT_FINGER_MAPPINGS: Array<{ vrmBone: VRMHumanBoneName; rigKey: string }> = [
  { vrmBone: VRMHumanBoneName.LeftThumbMetacarpal, rigKey: 'LeftThumbProximal' },
  { vrmBone: VRMHumanBoneName.LeftThumbProximal, rigKey: 'LeftThumbIntermediate' },
  { vrmBone: VRMHumanBoneName.LeftThumbDistal, rigKey: 'LeftThumbDistal' },
  { vrmBone: VRMHumanBoneName.LeftIndexProximal, rigKey: 'LeftIndexProximal' },
  { vrmBone: VRMHumanBoneName.LeftIndexIntermediate, rigKey: 'LeftIndexIntermediate' },
  { vrmBone: VRMHumanBoneName.LeftIndexDistal, rigKey: 'LeftIndexDistal' },
  { vrmBone: VRMHumanBoneName.LeftMiddleProximal, rigKey: 'LeftMiddleProximal' },
  { vrmBone: VRMHumanBoneName.LeftMiddleIntermediate, rigKey: 'LeftMiddleIntermediate' },
  { vrmBone: VRMHumanBoneName.LeftMiddleDistal, rigKey: 'LeftMiddleDistal' },
  { vrmBone: VRMHumanBoneName.LeftRingProximal, rigKey: 'LeftRingProximal' },
  { vrmBone: VRMHumanBoneName.LeftRingIntermediate, rigKey: 'LeftRingIntermediate' },
  { vrmBone: VRMHumanBoneName.LeftRingDistal, rigKey: 'LeftRingDistal' },
  { vrmBone: VRMHumanBoneName.LeftLittleProximal, rigKey: 'LeftLittleProximal' },
  { vrmBone: VRMHumanBoneName.LeftLittleIntermediate, rigKey: 'LeftLittleIntermediate' },
  { vrmBone: VRMHumanBoneName.LeftLittleDistal, rigKey: 'LeftLittleDistal' }
];

export class VrmAvatarViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private currentVrm: VRM | null = null;
  private clock: THREE.Clock;
  private isAnimating: boolean = false;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  // Estado dinámico de landmarks recibidos
  private latestLandmarks: HolisticFrameLandmarks | null = null;

  constructor(config: VrmAvatarConfig) {
    this.container = config.container;
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 600;

    // 1. Escena con fondo oscuro coherente con el tema de la app
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1120);

    // 2. Cámara enfocando busto, cabeza y brazos (campo visual calibrado para lengua de señas)
    this.camera = new THREE.PerspectiveCamera(32.0, w / h, 0.1, 20.0);
    this.camera.position.set(0.0, 1.18, 2.35);
    this.camera.lookAt(0, 1.05, 0);

    // 3. Renderizador WebGL — el canvas se inyecta en el contenedor
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 4. Iluminación para resaltar manos y rostro del avatar
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(1.0, 2.5, 2.0).normalize();
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.7);
    fillLight.position.set(-1.5, 1.0, 1.0).normalize();
    this.scene.add(fillLight);

    this.clock = new THREE.Clock();

    // 5. Redimensionado automático cuando el contenedor cambia de tamaño
    this.resizeObserver = new ResizeObserver(() => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.resize(rect.width, rect.height);
      }
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Carga el modelo VRM desde la URL pública.
   * Retorna la instancia VRM para permitir retargeting externo.
   */
  public async loadModel(url: string = VRM_MODEL_URL): Promise<VRM> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            reject(new Error('[VrmAvatarViewer] El archivo cargado no contiene metadatos VRM válidos.'));
            return;
          }

          // Limpieza de mallas y orientación frontal nativa
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          vrm.scene.rotation.y = 0;

          if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            VRMUtils.deepDispose(this.currentVrm.scene);
          }

          this.currentVrm = vrm;
          this.scene.add(vrm.scene);

          console.log('[VrmAvatarViewer] ✓ Modelo VRM cargado:', url);
          resolve(vrm);
        },
        (progress) => {
          if (progress.total > 0) {
            const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
            console.log(`[VrmAvatarViewer] Cargando modelo: ${pct}%`);
          }
        },
        (error) => {
          console.error('[VrmAvatarViewer] Error al cargar VRM:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Actualiza los landmarks activos para retargeting en el siguiente frame.
   */
  public updatePose(landmarks: HolisticFrameLandmarks): void {
    this.latestLandmarks = landmarks;
  }

  /**
   * Inicia el bucle de renderizado Three.js.
   */
  public start(): void {
    if (this.isAnimating) return;
    this.isAnimating = true;

    const animate = () => {
      if (!this.isAnimating) return;
      requestAnimationFrame(animate);

      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();

      if (this.currentVrm) {
        const hasLiveInput = this.latestLandmarks && (
          (this.latestLandmarks.pose && this.latestLandmarks.pose.length > 0) ||
          (this.latestLandmarks.rightHand && this.latestLandmarks.rightHand.length === 21) ||
          (this.latestLandmarks.leftHand && this.latestLandmarks.leftHand.length === 21)
        );

        if (hasLiveInput && this.latestLandmarks) {
          // Cinemática activa con Kalidokit
          this.applyKalidokitRetargeting(this.latestLandmarks);
        } else {
          // Pose de descanso neutral cuando no hay detección
          this.applyRestingPose(elapsed);
        }

        // Actualizar cinemática interna del VRM (expresiones, springs de pelo/ropa)
        this.currentVrm.update(delta);
      }

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  /**
   * Aplica cinemática inversa con Kalidokit desde landmarks del usuario.
   */
  private applyKalidokitRetargeting(landmarks: HolisticFrameLandmarks): void {
    if (!this.currentVrm) return;

    // 1. Pose corporal adaptada para Kalidokit
    // MediaPipe entrega landmarks desde la perspectiva del sensor.
    // Para que Kalidokit calcule las rotaciones con la orientación lateral correcta:
    // Mapeamos los índices laterales (11<->12 hombros, 13<->14 codos, 15<->16 muñecas) e invertimos X.
    if (landmarks.pose && landmarks.poseWorld && landmarks.pose.length >= 25 && landmarks.poseWorld.length >= 25) {
      try {
        const pw = landmarks.poseWorld;
        const p2 = landmarks.pose;

        const adaptedWorld = pw.map((pt, idx) => {
          let target = pt;
          if (idx === 11) target = pw[12];
          else if (idx === 12) target = pw[11];
          else if (idx === 13) target = pw[14];
          else if (idx === 14) target = pw[13];
          else if (idx === 15) target = pw[16];
          else if (idx === 16) target = pw[15];
          return { x: -target.x, y: target.y, z: target.z, visibility: target.visibility };
        });

        const adaptedPose = p2.map((pt, idx) => {
          let target = pt;
          if (idx === 11) target = p2[12];
          else if (idx === 12) target = p2[11];
          else if (idx === 13) target = p2[14];
          else if (idx === 14) target = p2[13];
          else if (idx === 15) target = p2[16];
          else if (idx === 16) target = p2[15];
          return { x: 1.0 - target.x, y: target.y, z: target.z, visibility: target.visibility };
        });

        const poseRig = KalidoPose.solve(
          adaptedWorld as any,
          adaptedPose as any,
          { runtime: 'mediapipe', enableLegs: false }
        );

        if (poseRig) {
          this.rigBone(VRMHumanBoneName.Hips, poseRig.Hips?.rotation, 0.7, 0.3);
          this.rigBone(VRMHumanBoneName.Spine, poseRig.Spine as any, 0.5, 0.3);
          this.rigBone(VRMHumanBoneName.RightUpperArm, poseRig.RightUpperArm, 1.0, 0.6);
          this.rigBone(VRMHumanBoneName.RightLowerArm, poseRig.RightLowerArm, 1.0, 0.6);
          this.rigBone(VRMHumanBoneName.LeftUpperArm, poseRig.LeftUpperArm, 1.0, 0.6);
          this.rigBone(VRMHumanBoneName.LeftLowerArm, poseRig.LeftLowerArm, 1.0, 0.6);

          // Si no hay detección detallada de mano, usar orientación de muñeca de la pose
          if (!landmarks.rightHand) {
            this.rigBone(VRMHumanBoneName.RightHand, poseRig.RightHand as any, 1.0, 0.5);
          }
          if (!landmarks.leftHand) {
            this.rigBone(VRMHumanBoneName.LeftHand, poseRig.LeftHand as any, 1.0, 0.5);
          }
        }
      } catch (err) {
        console.warn('[VrmAvatarViewer] Error al resolver Pose con Kalidokit:', err);
      }
    }

    // 2. Dedos y muñeca mano derecha (21 puntos)
    if (landmarks.rightHand && landmarks.rightHand.length === 21) {
      try {
        const rightRig = KalidoHand.solve(landmarks.rightHand as any, 'Right');
        if (rightRig) {
          // Orientación anatómica de muñeca derecha calculada por HandSolver
          if (rightRig.RightWrist) {
            this.rigBone(VRMHumanBoneName.RightHand, rightRig.RightWrist, 1.0, 0.6);
          }
          for (const mapping of RIGHT_FINGER_MAPPINGS) {
            const rot = (rightRig as any)[mapping.rigKey];
            if (rot) {
              this.rigBone(mapping.vrmBone, rot, 1.0, 0.6);
            }
          }
        }
      } catch (err) {
        console.warn('[VrmAvatarViewer] Error al resolver Mano Derecha con Kalidokit:', err);
      }
    }

    // 3. Dedos y muñeca mano izquierda (21 puntos)
    if (landmarks.leftHand && landmarks.leftHand.length === 21) {
      try {
        const leftRig = KalidoHand.solve(landmarks.leftHand as any, 'Left');
        if (leftRig) {
          // Orientación anatómica de muñeca izquierda calculada por HandSolver
          if (leftRig.LeftWrist) {
            this.rigBone(VRMHumanBoneName.LeftHand, leftRig.LeftWrist, 1.0, 0.6);
          }
          for (const mapping of LEFT_FINGER_MAPPINGS) {
            const rot = (leftRig as any)[mapping.rigKey];
            if (rot) {
              this.rigBone(mapping.vrmBone, rot, 1.0, 0.6);
            }
          }
        }
      } catch (err) {
        console.warn('[VrmAvatarViewer] Error al resolver Mano Izquierda con Kalidokit:', err);
      }
    }

    // 4. Expresiones faciales y Blendshapes (Prosoponema)
    if (landmarks.blendshapes && this.currentVrm.expressionManager) {
      const bs = landmarks.blendshapes;
      if (bs['eyeBlinkLeft'] !== undefined) {
        this.currentVrm.expressionManager.setValue('blinkLeft', bs['eyeBlinkLeft']);
      }
      if (bs['eyeBlinkRight'] !== undefined) {
        this.currentVrm.expressionManager.setValue('blinkRight', bs['eyeBlinkRight']);
      }
      if (bs['jawOpen'] !== undefined) {
        this.currentVrm.expressionManager.setValue('aa', Math.min(1.0, bs['jawOpen'] * 1.4));
      }
      if (bs['mouthSmileLeft'] !== undefined || bs['mouthSmileRight'] !== undefined) {
        const smile = ((bs['mouthSmileLeft'] ?? 0) + (bs['mouthSmileRight'] ?? 0)) / 2;
        this.currentVrm.expressionManager.setValue('happy', smile);
      }
    }

    // 5. Prioridad absoluta: vrm_pose_override (ADR-002)
    if (landmarks.vrmPoseOverride) {
      for (const [boneName, quatArr] of Object.entries(landmarks.vrmPoseOverride)) {
        const boneNode = this.currentVrm.humanoid.getNormalizedBoneNode(boneName as VRMHumanBoneName);
        if (boneNode && quatArr.length === 4) {
          const overrideQuat = new THREE.Quaternion(quatArr[0], quatArr[1], quatArr[2], quatArr[3]);
          boneNode.quaternion.slerp(overrideQuat, 0.8);
        }
      }
    }
  }

  /**
   * Aplica pose de descanso con respiración sutil cuando no hay tracking.
   */
  private applyRestingPose(elapsed: number): void {
    if (!this.currentVrm) return;

    const neck = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
    if (neck) {
      neck.rotation.x = Math.sin(elapsed * 0.8) * 0.02;
    }

    const rightUpperArm = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    if (rightUpperArm) {
      rightUpperArm.rotation.z = -0.15 + Math.sin(elapsed * 0.6) * 0.02;
    }

    const leftUpperArm = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    if (leftUpperArm) {
      leftUpperArm.rotation.z = 0.15 + Math.sin(elapsed * 0.6) * 0.02;
    }
  }

  /**
   * Helper para aplicar rotación a un hueso VRM usando slerp para suavizado.
   */
  private rigBone(
    boneName: VRMHumanBoneName,
    rotation?: { x: number; y: number; z: number; rotationOrder?: string },
    dampFactor: number = 1.0,
    lerpAmount: number = 0.4
  ): void {
    if (!this.currentVrm || !rotation) return;
    const boneNode = this.currentVrm.humanoid.getNormalizedBoneNode(boneName);
    if (!boneNode) return;

    const euler = new THREE.Euler(
      rotation.x * dampFactor,
      rotation.y * dampFactor,
      rotation.z * dampFactor,
      (rotation.rotationOrder as any) || 'XYZ'
    );
    const targetQuat = new THREE.Quaternion().setFromEuler(euler);
    boneNode.quaternion.slerp(targetQuat, lerpAmount);
  }

  public stop(): void {
    this.isAnimating = false;
  }

  /** Expone el VRM actual para inspección o utilidades */
  public getVrm(): VRM | null {
    return this.currentVrm;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.stop();
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
    }
    this.renderer.dispose();
  }
}
