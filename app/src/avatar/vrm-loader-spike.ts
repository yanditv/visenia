/**
 * Carga y control del Avatar VRM con Three.js (RF-42)
 *
 * Sprint 1 (PR #11): Integración del modelo real visenia.vrm en la vista dividida.
 * El visor se monta en #avatar-container (panel derecho) y comparte el bucle RAF
 * con el espejo del usuario.
 *
 * Dependencias: three, @pixiv/three-vrm
 * ADR de referencia: ADR-002 (retargeting VRM)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';

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

  constructor(config: VrmAvatarConfig) {
    this.container = config.container;
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 600;

    // 1. Escena con fondo oscuro coherente con el tema de la app
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1120);

    // 2. Cámara enfocando busto y brazos (zona clave para lengua de señas)
    this.camera = new THREE.PerspectiveCamera(28.0, w / h, 0.1, 20.0);
    this.camera.position.set(0.0, 1.3, 2.0);
    this.camera.lookAt(0, 1.1, 0);

    // 3. Renderizador WebGL — el canvas se inyecta en el contenedor
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 4. Iluminación para resaltar manos y rostro del avatar
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(1.0, 2.5, 2.0).normalize();
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
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
   * Retorna la instancia VRM para permitir retargeting externo (Kalidokit).
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

          // Limpieza de vértices y joints innecesarios (optimización VRoid)
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          // Orientar avatar hacia la cámara
          vrm.scene.rotation.y = Math.PI;

          // Reemplazar modelo anterior si existía
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
   * Inicia el bucle de renderizado Three.js.
   * En Sprint 1 anima una pose de descanso neutral.
   * En Sprint 2 (Kalidokit) este método recibirá los datos de pose en vivo.
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
        // Pose de descanso: respiración sutil en el cuello
        const neck = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
        if (neck) {
          neck.rotation.x = Math.sin(elapsed * 0.8) * 0.02;
        }

        // Brazos en posición relajada a los costados
        const rightUpperArm = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
        if (rightUpperArm) {
          rightUpperArm.rotation.z = -0.15 + Math.sin(elapsed * 0.6) * 0.02;
        }

        const leftUpperArm = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
        if (leftUpperArm) {
          leftUpperArm.rotation.z = 0.15 + Math.sin(elapsed * 0.6) * 0.02;
        }

        // Actualizar cinemática interna del VRM (blendshapes, springs, etc.)
        this.currentVrm.update(delta);
      }

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  public stop(): void {
    this.isAnimating = false;
  }

  /** Expone el VRM actual para retargeting externo (Kalidokit — PR #12) */
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
