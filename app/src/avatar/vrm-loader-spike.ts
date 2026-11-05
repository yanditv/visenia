/**
 * Carga y control del Avatar VRM con Three.js (RF-42, ADR-002)
 *
 * Retargeting directo sobre el humanoide normalizado, con coordenadas de captura coherentes.
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
  private animationFrame: number | null = null;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  private overrideBones = new Set<string>();

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
    this.resize(w, h);

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
            reject(
              new Error('[VrmAvatarViewer] El archivo cargado no contiene metadatos VRM válidos.')
            );
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
    this.clock.start();

    const animate = () => {
      if (!this.isAnimating) return;
      this.animationFrame = requestAnimationFrame(animate);

      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();

      if (this.currentVrm) {
        const hasLiveInput =
          this.latestLandmarks &&
          ((this.latestLandmarks.pose && this.latestLandmarks.pose.length > 0) ||
            (this.latestLandmarks.rightHand && this.latestLandmarks.rightHand.length === 21) ||
            (this.latestLandmarks.leftHand && this.latestLandmarks.leftHand.length === 21) ||
            !!this.latestLandmarks.vrmPoseOverride ||
            !!this.latestLandmarks.blendshapes);

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
    const overrides = landmarks.vrmPoseOverride ?? {};
    // Release corrections when a later frame no longer includes that bone.
    for (const name of this.overrideBones ?? []) {
      if (!(name in overrides))
        this.currentVrm.humanoid
          .getNormalizedBoneNode(name as VRMHumanBoneName)
          ?.quaternion.identity();
    }
    this.overrideBones = new Set(Object.keys(overrides));
    // Metric Pose and image Pose have separate scales; never subtract a Hand Z from a Pose Z.
    const metric = !!landmarks.poseWorld?.length;
    const pose = metric ? landmarks.poseWorld : landmarks.pose;
    const aspect = metric ? 1 : (landmarks.imageAspect ?? 1);
    const direction = (from: LandmarkPoint, to: LandmarkPoint) =>
      new THREE.Vector3(
        -(to.x - from.x) * aspect,
        -(to.y - from.y),
        -((to.z ?? 0) - (from.z ?? 0)) * aspect
      );
    for (const [side, shoulder, elbow, wrist] of [
      ['right', 11, 13, 15],
      ['left', 12, 14, 16],
    ] as const) {
      const axis = new THREE.Vector3(side === 'right' ? -1 : 1, 0, 0);
      const upperName = (side + 'UpperArm') as VRMHumanBoneName;
      const lowerName = (side + 'LowerArm') as VRMHumanBoneName;
      const rest = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, side === 'right' ? 1.32 : -1.32)
      );
      const visible = (index: number) => pose?.[index] && (pose[index].visibility ?? 1) > 0.25;
      if (pose && visible(shoulder) && visible(elbow)) {
        const upperDirection = direction(pose[shoulder], pose[elbow]);
        if (upperDirection.lengthSq() > 1e-10) {
          this.rigBoneQuat(
            upperName,
            new THREE.Quaternion().setFromUnitVectors(axis, upperDirection.normalize()),
            0.45
          );
        }
        if (visible(wrist)) {
          const forearm = direction(pose[elbow], pose[wrist]);
          const upper = this.currentVrm.humanoid.getNormalizedBoneNode(upperName);
          if (upper && forearm.lengthSq() > 1e-10) {
            upper.updateWorldMatrix(true, false);
            forearm
              .normalize()
              .applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
            this.rigBoneQuat(
              lowerName,
              new THREE.Quaternion().setFromUnitVectors(axis, forearm),
              0.5
            );
          }
        } else {
          this.rigBoneQuat(lowerName, new THREE.Quaternion(), 0.25);
        }
      } else {
        this.rigBoneQuat(upperName, rest, 0.2);
        this.rigBoneQuat(lowerName, new THREE.Quaternion(), 0.25);
      }
      const hand = side === 'right' ? landmarks.leftHand : landmarks.rightHand;
      if (hand?.length === 21)
        this.applyFingerArticulations(hand, side, landmarks.imageAspect ?? 1);
      else this.relaxFingers(side);
    }
    this.applyExpressions(landmarks.blendshapes);
    for (const [name, values] of Object.entries(overrides)) {
      if (values.length !== 4 || !values.every(Number.isFinite)) continue;
      const q = new THREE.Quaternion(...values);
      if (q.lengthSq() > 1e-10)
        this.currentVrm.humanoid
          .getNormalizedBoneNode(name as VRMHumanBoneName)
          ?.quaternion.copy(q.normalize());
    }
  }

  private applyExpressions(bs: Record<string, number> = {}): void {
    const manager = this.currentVrm?.expressionManager;
    if (!manager) return;
    const value = (key: string) =>
      Number.isFinite(bs[key]) ? THREE.MathUtils.clamp(bs[key], 0, 1) : 0;
    manager.setValue('blinkLeft', value('eyeBlinkLeft'));
    manager.setValue('blinkRight', value('eyeBlinkRight'));
    manager.setValue('aa', Math.min(1, value('jawOpen') * 1.4));
    manager.setValue('happy', (value('mouthSmileLeft') + value('mouthSmileRight')) / 2);
  }

  /** Hand basis in image space -> world orientation -> orientation local to the forearm. */
  private applyFingerArticulations(
    hand: LandmarkPoint[],
    side: 'right' | 'left',
    aspect = 1
  ): void {
    if (!this.currentVrm || hand.length !== 21) return;
    const sign = side === 'right' ? 1 : -1;
    const vector = (a: number, b: number) =>
      new THREE.Vector3(
        -(hand[b].x - hand[a].x) * aspect,
        -(hand[b].y - hand[a].y),
        -((hand[b].z ?? 0) - (hand[a].z ?? 0)) * aspect
      );
    const heading = vector(0, 9);
    const across = vector(17, 5);
    const normal = new THREE.Vector3().crossVectors(heading, across);
    const wrist = this.currentVrm.humanoid.getNormalizedBoneNode(
      (side + 'Hand') as VRMHumanBoneName
    );
    if (wrist && heading.lengthSq() > 1e-10 && normal.lengthSq() > 1e-10) {
      const x = heading.clone().normalize().multiplyScalar(-sign);
      const z = normal.normalize().multiplyScalar(-sign);
      const y = new THREE.Vector3().crossVectors(z, x).normalize();
      const target = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(x, y, z)
      );
      // Calibrate against this normalized rig: VRoid palms lie in XZ, not XY.
      const middle = this.currentVrm.humanoid.getNormalizedBoneNode(
        (side + 'MiddleProximal') as VRMHumanBoneName
      );
      const index = this.currentVrm.humanoid.getNormalizedBoneNode(
        (side + 'IndexProximal') as VRMHumanBoneName
      );
      const little = this.currentVrm.humanoid.getNormalizedBoneNode(
        (side + 'LittleProximal') as VRMHumanBoneName
      );
      if (middle && index && little) {
        const restX = middle.position.clone().normalize().multiplyScalar(-sign);
        const restZ = new THREE.Vector3().crossVectors(
          middle.position,
          index.position.clone().sub(little.position)
        );
        if (restX.lengthSq() > 1e-10 && restZ.lengthSq() > 1e-10) {
          restZ.normalize().multiplyScalar(-sign);
          const restY = new THREE.Vector3().crossVectors(restZ, restX).normalize();
          target.multiply(
            new THREE.Quaternion()
              .setFromRotationMatrix(new THREE.Matrix4().makeBasis(restX, restY, restZ))
              .invert()
          );
        }
      }
      if (wrist.parent) {
        wrist.parent.updateWorldMatrix(true, false);
        target.premultiply(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      }
      wrist.quaternion.slerp(target, 0.35);
    }
    const angle = (a: number, b: number, c: number) => {
      const incoming = vector(a, b),
        outgoing = vector(b, c);
      return incoming.lengthSq() > 1e-10 && outgoing.lengthSq() > 1e-10
        ? Math.min(1.5, incoming.angleTo(outgoing))
        : 0;
    };
    for (const [finger, start] of [
      ['Index', 5],
      ['Middle', 9],
      ['Ring', 13],
      ['Little', 17],
    ] as const) {
      for (const [joint, a, b, c] of [
        ['Proximal', 0, start, start + 1],
        ['Intermediate', start, start + 1, start + 2],
        ['Distal', start + 1, start + 2, start + 3],
      ] as const) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle(a, b, c) * sign));
        this.rigBoneQuat((side + finger + joint) as VRMHumanBoneName, q, 0.4);
      }
    }
    for (const [joint, a, b, c] of [
      ['Metacarpal', 0, 1, 2],
      ['Proximal', 1, 2, 3],
      ['Distal', 2, 3, 4],
    ] as const) {
      const flex = angle(a, b, c);
      this.rigBoneQuat(
        (side + 'Thumb' + joint) as VRMHumanBoneName,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(flex * 0.4, 0, flex * sign)),
        0.4
      );
    }
  }

  /**
   * Slerp de dedos y muñecas hacia postura relajada abierta cuando la mano no está en cuadro.
   */
  private relaxFingers(side: 'right' | 'left'): void {
    const ident = new THREE.Quaternion();
    const bones =
      side === 'right'
        ? [
            VRMHumanBoneName.RightHand,
            VRMHumanBoneName.RightThumbMetacarpal,
            VRMHumanBoneName.RightThumbProximal,
            VRMHumanBoneName.RightThumbDistal,
            VRMHumanBoneName.RightIndexProximal,
            VRMHumanBoneName.RightIndexIntermediate,
            VRMHumanBoneName.RightIndexDistal,
            VRMHumanBoneName.RightMiddleProximal,
            VRMHumanBoneName.RightMiddleIntermediate,
            VRMHumanBoneName.RightMiddleDistal,
            VRMHumanBoneName.RightRingProximal,
            VRMHumanBoneName.RightRingIntermediate,
            VRMHumanBoneName.RightRingDistal,
            VRMHumanBoneName.RightLittleProximal,
            VRMHumanBoneName.RightLittleIntermediate,
            VRMHumanBoneName.RightLittleDistal,
          ]
        : [
            VRMHumanBoneName.LeftHand,
            VRMHumanBoneName.LeftThumbMetacarpal,
            VRMHumanBoneName.LeftThumbProximal,
            VRMHumanBoneName.LeftThumbDistal,
            VRMHumanBoneName.LeftIndexProximal,
            VRMHumanBoneName.LeftIndexIntermediate,
            VRMHumanBoneName.LeftIndexDistal,
            VRMHumanBoneName.LeftMiddleProximal,
            VRMHumanBoneName.LeftMiddleIntermediate,
            VRMHumanBoneName.LeftMiddleDistal,
            VRMHumanBoneName.LeftRingProximal,
            VRMHumanBoneName.LeftRingIntermediate,
            VRMHumanBoneName.LeftRingDistal,
            VRMHumanBoneName.LeftLittleProximal,
            VRMHumanBoneName.LeftLittleIntermediate,
            VRMHumanBoneName.LeftLittleDistal,
          ];

    for (const b of bones) {
      this.rigBoneQuat(b, ident, 0.2);
    }
  }

  /**
   * Helper para rotación de hueso VRM por cuaternión con slerp.
   */
  private rigBoneQuat(
    boneName: VRMHumanBoneName,
    targetQuat: THREE.Quaternion,
    lerpAmount: number = 0.35
  ): void {
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

    for (const name of this.overrideBones ?? [])
      this.currentVrm.humanoid
        .getNormalizedBoneNode(name as VRMHumanBoneName)
        ?.quaternion.identity();
    this.overrideBones = new Set();
    const neck = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
    if (neck) {
      neck.rotation.x = Math.sin(elapsed * 0.8) * 0.02;
    }

    const rightArmRestQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, 1.32 + Math.sin(elapsed * 0.6) * 0.02)
    );
    const leftArmRestQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, -1.32 - Math.sin(elapsed * 0.6) * 0.02)
    );
    const identQuat = new THREE.Quaternion();

    this.rigBoneQuat(VRMHumanBoneName.RightUpperArm, rightArmRestQuat, 0.15);
    this.rigBoneQuat(VRMHumanBoneName.LeftUpperArm, leftArmRestQuat, 0.15);
    this.rigBoneQuat(VRMHumanBoneName.RightLowerArm, identQuat, 0.2);
    this.rigBoneQuat(VRMHumanBoneName.LeftLowerArm, identQuat, 0.2);

    this.relaxFingers('right');
    this.relaxFingers('left');
    this.applyExpressions();
  }

  public resetPose(): void {
    if (!this.currentVrm) return;
    for (const name of Object.values(VRMHumanBoneName)) {
      this.currentVrm.humanoid.getNormalizedBoneNode(name)?.quaternion.identity();
    }
    this.overrideBones = new Set();
    this.latestLandmarks = null;
    this.applyExpressions();
  }

  public stop(): void {
    this.isAnimating = false;
    if (this.animationFrame != null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  /** Expone el VRM actual para inspección o utilidades */
  public getVrm(): VRM | null {
    return this.currentVrm;
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distance = 1.08 * Math.max(0.85 / halfFov, 0.95 / (halfFov * this.camera.aspect));
    this.camera.position.set(0, 1.15, distance);
    this.camera.lookAt(0, 1.15, 0);
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
