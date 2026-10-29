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
import { HolisticFrameLandmarks, LandmarkPoint } from '../render/skeleton-renderer';

/** Ruta pública del modelo VRM del proyecto */
export const VRM_MODEL_URL = '/models/visenia.vrm';

export interface VrmAvatarConfig {
  /** Contenedor HTML donde se montará el canvas Three.js */
  container: HTMLElement;
}

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
          this.applyDirectMirrorKinematics(this.latestLandmarks);
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
   * Aplica cinemática directa con reflejo especular en tiempo real.
   * Resuelve:
   * 1. Inversión de eje Y: en MediaPipe Y aumenta hacia abajo; aquí se invierte (-dy) para que el avatar siga la dirección física real.
   * 2. Lateralidad visual coherente: el brazo en el panel izquierdo de la cámara mueve el brazo en el lado izquierdo del avatar.
   * 3. Prevención de extremidades congeladas: se emplean los 33 landmarks de Pose como base continua; si un brazo o mano sale de cuadro,
   *    slerp interpola suavemente a la postura de descanso en vez de trabarse.
   * 4. Configuración manual articulada (Queirema): se computa el grado de extensión/curvatura (curl) de cada uno de los 5 dedos y la normal de la palma.
   */
  private applyDirectMirrorKinematics(landmarks: HolisticFrameLandmarks): void {
    if (!this.currentVrm) return;

    const pose = landmarks.pose;
    const rightArmRestQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.32));
    const leftArmRestQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.32));
    const identQuat = new THREE.Quaternion();

    // ─── 1. Brazo ubicado a la izquierda de la pantalla (RightUpperArm/RightLowerArm del VRM) ───
    // En cámara frontal con espejo, este corresponde a la mitad x < 0.5 (pose[12] hombro der, pose[14] codo der)
    if (pose && pose[12] && pose[14] && (pose[12].visibility ?? 1.0) > 0.25 && (pose[14].visibility ?? 1.0) > 0.25) {
      // Inversión explícita del eje Y: en canvas Y crece hacia abajo; en Three.js Y positivo es arriba
      const udx = pose[14].x - pose[12].x;
      const udy = -(pose[14].y - pose[12].y);
      const udz = -((pose[14].z ?? 0) - (pose[12].z ?? 0));
      const vUpper = new THREE.Vector3(udx, udy, udz).normalize();

      // RightUpperArm en VRM T-Pose apunta hacia (-1, 0, 0)
      const qUpper = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), vUpper);
      this.rigBoneQuat(VRMHumanBoneName.RightUpperArm, qUpper, 0.45);

      // Antebrazo (codo a muñeca)
      const wrist = (landmarks.rightHand && landmarks.rightHand[0]) ? landmarks.rightHand[0] : pose[16];
      if (wrist && (wrist.visibility ?? 1.0) > 0.25) {
        const fdx = wrist.x - pose[14].x;
        const fdy = -(wrist.y - pose[14].y); // Inversión de Y en antebrazo
        const fdz = -((wrist.z ?? 0) - (pose[14].z ?? 0));
        const vForearm = new THREE.Vector3(fdx, fdy, fdz).normalize();

        const vLocal = vForearm.clone().applyQuaternion(qUpper.clone().invert());
        const qLower = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), vLocal);
        this.rigBoneQuat(VRMHumanBoneName.RightLowerArm, qLower, 0.5);
      } else {
        this.rigBoneQuat(VRMHumanBoneName.RightLowerArm, identQuat, 0.25);
      }
    } else {
      // Si el brazo sale de la cámara, interpolación suave a reposo (no se congela en el aire)
      this.rigBoneQuat(VRMHumanBoneName.RightUpperArm, rightArmRestQuat, 0.2);
      this.rigBoneQuat(VRMHumanBoneName.RightLowerArm, identQuat, 0.25);
    }

    // ─── 2. Brazo ubicado a la derecha de la pantalla (LeftUpperArm/LeftLowerArm del VRM) ───
    // En cámara frontal con espejo, este corresponde a la mitad x > 0.5 (pose[11] hombro izq, pose[13] codo izq)
    if (pose && pose[11] && pose[13] && (pose[11].visibility ?? 1.0) > 0.25 && (pose[13].visibility ?? 1.0) > 0.25) {
      const udx = pose[13].x - pose[11].x;
      const udy = -(pose[13].y - pose[11].y);
      const udz = -((pose[13].z ?? 0) - (pose[11].z ?? 0));
      const vUpper = new THREE.Vector3(udx, udy, udz).normalize();

      // LeftUpperArm en VRM T-Pose apunta hacia (1, 0, 0)
      const qUpper = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vUpper);
      this.rigBoneQuat(VRMHumanBoneName.LeftUpperArm, qUpper, 0.45);

      // Antebrazo
      const wrist = (landmarks.leftHand && landmarks.leftHand[0]) ? landmarks.leftHand[0] : pose[15];
      if (wrist && (wrist.visibility ?? 1.0) > 0.25) {
        const fdx = wrist.x - pose[13].x;
        const fdy = -(wrist.y - pose[13].y);
        const fdz = -((wrist.z ?? 0) - (pose[13].z ?? 0));
        const vForearm = new THREE.Vector3(fdx, fdy, fdz).normalize();

        const vLocal = vForearm.clone().applyQuaternion(qUpper.clone().invert());
        const qLower = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vLocal);
        this.rigBoneQuat(VRMHumanBoneName.LeftLowerArm, qLower, 0.5);
      } else {
        this.rigBoneQuat(VRMHumanBoneName.LeftLowerArm, identQuat, 0.25);
      }
    } else {
      // Reposo suave si sale del encuadre
      this.rigBoneQuat(VRMHumanBoneName.LeftUpperArm, leftArmRestQuat, 0.2);
      this.rigBoneQuat(VRMHumanBoneName.LeftLowerArm, identQuat, 0.25);
    }

    // ─── 3. Articulación fonológica de mano derecha (21 puntos) ───
    if (landmarks.rightHand && landmarks.rightHand.length === 21) {
      this.applyFingerArticulations(landmarks.rightHand, 'right');
    } else {
      this.relaxFingers('right');
    }

    // ─── 4. Articulación fonológica de mano izquierda (21 puntos) ───
    if (landmarks.leftHand && landmarks.leftHand.length === 21) {
      this.applyFingerArticulations(landmarks.leftHand, 'left');
    } else {
      this.relaxFingers('left');
    }

    // ─── 5. Expresiones faciales y Blendshapes (Prosoponema) ───
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

    // ─── 6. Prioridad absoluta: vrm_pose_override (ADR-002) ───
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
   * Articula los 5 dedos y muñeca a partir de los 21 puntos anatómicos.
   * Calcula el ratio de flexión (curl) de cada falange para distinguir Mano Abierta vs Puño vs Pinzas.
   */
  private applyFingerArticulations(hand: LandmarkPoint[], side: 'right' | 'left'): void {
    if (!this.currentVrm) return;
    const sign = side === 'right' ? 1 : -1;
    const wristNode = this.currentVrm.humanoid.getNormalizedBoneNode(
      side === 'right' ? VRMHumanBoneName.RightHand : VRMHumanBoneName.LeftHand
    );

    // Orientación de la palma y muñeca
    if (wristNode && hand[0] && hand[9] && hand[5] && hand[17]) {
      const hdx = hand[9].x - hand[0].x;
      const hdy = -(hand[9].y - hand[0].y); // Inversión Y
      const hdz = -((hand[9].z ?? 0) - (hand[0].z ?? 0));
      const handHeading = new THREE.Vector3(hdx, hdy, hdz).normalize();

      const vIndex = new THREE.Vector3(hand[5].x - hand[0].x, -(hand[5].y - hand[0].y), 0);
      const vPinky = new THREE.Vector3(hand[17].x - hand[0].x, -(hand[17].y - hand[0].y), 0);
      const palmNormal = new THREE.Vector3().crossVectors(vIndex, vPinky).normalize();

      const wristAngleZ = Math.atan2(handHeading.y, Math.abs(handHeading.x) + 1e-4) * 0.5 * sign;
      const wristAngleY = -palmNormal.z * 0.4 * sign;
      const qWrist = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, wristAngleY, wristAngleZ));
      wristNode.quaternion.slerp(qWrist, 0.35);
    }

    // Curvatura de dedos (0.0 = Mano Abierta / extendido, 1.0 = Puño / flexionado)
    const computeCurl = (tipIdx: number, mcpIdx: number): number => {
      const dTip = Math.hypot(hand[tipIdx].x - hand[0].x, hand[tipIdx].y - hand[0].y);
      const dMcp = Math.hypot(hand[mcpIdx].x - hand[0].x, hand[mcpIdx].y - hand[0].y);
      const ratio = dTip / (dMcp + 1e-4);
      return Math.min(1.0, Math.max(0.0, (1.7 - ratio) / (1.7 - 0.95)));
    };

    const curlThumb = computeCurl(4, 2);
    const curlIndex = computeCurl(8, 5);
    const curlMiddle = computeCurl(12, 9);
    const curlRing = computeCurl(16, 13);
    const curlLittle = computeCurl(20, 17);

    const applyDigitBones = (
      proximalName: VRMHumanBoneName,
      interName: VRMHumanBoneName,
      distalName: VRMHumanBoneName,
      curlVal: number
    ) => {
      const angle = curlVal * 0.85 * sign;
      const qFinger = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle));
      this.rigBoneQuat(proximalName, qFinger, 0.4);
      this.rigBoneQuat(interName, qFinger, 0.4);
      this.rigBoneQuat(distalName, qFinger, 0.4);
    };

    if (side === 'right') {
      const qThumb = new THREE.Quaternion().setFromEuler(new THREE.Euler(curlThumb * 0.3, 0, curlThumb * 0.5));
      this.rigBoneQuat(VRMHumanBoneName.RightThumbProximal, qThumb, 0.4);
      this.rigBoneQuat(VRMHumanBoneName.RightThumbDistal, qThumb, 0.4);

      applyDigitBones(VRMHumanBoneName.RightIndexProximal, VRMHumanBoneName.RightIndexIntermediate, VRMHumanBoneName.RightIndexDistal, curlIndex);
      applyDigitBones(VRMHumanBoneName.RightMiddleProximal, VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal, curlMiddle);
      applyDigitBones(VRMHumanBoneName.RightRingProximal, VRMHumanBoneName.RightRingIntermediate, VRMHumanBoneName.RightRingDistal, curlRing);
      applyDigitBones(VRMHumanBoneName.RightLittleProximal, VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal, curlLittle);
    } else {
      const qThumb = new THREE.Quaternion().setFromEuler(new THREE.Euler(curlThumb * 0.3, 0, -curlThumb * 0.5));
      this.rigBoneQuat(VRMHumanBoneName.LeftThumbProximal, qThumb, 0.4);
      this.rigBoneQuat(VRMHumanBoneName.LeftThumbDistal, qThumb, 0.4);

      applyDigitBones(VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.LeftIndexDistal, curlIndex);
      applyDigitBones(VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.LeftMiddleDistal, curlMiddle);
      applyDigitBones(VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.LeftRingDistal, curlRing);
      applyDigitBones(VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.LeftLittleDistal, curlLittle);
    }
  }

  /**
   * Slerp de dedos y muñecas hacia postura relajada abierta cuando la mano no está en cuadro.
   */
  private relaxFingers(side: 'right' | 'left'): void {
    const ident = new THREE.Quaternion();
    const bones = side === 'right'
      ? [
          VRMHumanBoneName.RightHand,
          VRMHumanBoneName.RightIndexProximal, VRMHumanBoneName.RightIndexIntermediate, VRMHumanBoneName.RightIndexDistal,
          VRMHumanBoneName.RightMiddleProximal, VRMHumanBoneName.RightMiddleIntermediate, VRMHumanBoneName.RightMiddleDistal,
          VRMHumanBoneName.RightRingProximal, VRMHumanBoneName.RightRingIntermediate, VRMHumanBoneName.RightRingDistal,
          VRMHumanBoneName.RightLittleProximal, VRMHumanBoneName.RightLittleIntermediate, VRMHumanBoneName.RightLittleDistal
        ]
      : [
          VRMHumanBoneName.LeftHand,
          VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.LeftIndexDistal,
          VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.LeftMiddleDistal,
          VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.LeftRingDistal,
          VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.LeftLittleDistal
        ];

    for (const b of bones) {
      this.rigBoneQuat(b, ident, 0.2);
    }
  }

  /**
   * Helper para rotación de hueso VRM por cuaternión con slerp.
   */
  private rigBoneQuat(boneName: VRMHumanBoneName, targetQuat: THREE.Quaternion, lerpAmount: number = 0.35): void {
    if (!this.currentVrm) return;
    const node = this.currentVrm.humanoid.getNormalizedBoneNode(boneName);
    if (!node) return;
    node.quaternion.slerp(targetQuat, lerpAmount);
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

    const rightArmRestQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, -1.32 + Math.sin(elapsed * 0.6) * 0.02)
    );
    const leftArmRestQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, 1.32 - Math.sin(elapsed * 0.6) * 0.02)
    );
    const identQuat = new THREE.Quaternion();

    this.rigBoneQuat(VRMHumanBoneName.RightUpperArm, rightArmRestQuat, 0.15);
    this.rigBoneQuat(VRMHumanBoneName.LeftUpperArm, leftArmRestQuat, 0.15);
    this.rigBoneQuat(VRMHumanBoneName.RightLowerArm, identQuat, 0.2);
    this.rigBoneQuat(VRMHumanBoneName.LeftLowerArm, identQuat, 0.2);

    this.relaxFingers('right');
    this.relaxFingers('left');
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
