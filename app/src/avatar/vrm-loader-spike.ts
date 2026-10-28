/**
 * Spike Técnico: Carga y Manipulación de Avatar VRM con Three.js (RF-42 Sec. 7)
 * Evalúa el rendimiento, carga de malla humanoid y control articular con @pixiv/three-vrm.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';

export interface VrmSpikeConfig {
  container: HTMLElement;
  width?: number;
  height?: number;
}

export class VrmAvatarViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private currentVrm: VRM | null = null;
  private clock: THREE.Clock;
  private isAnimating: boolean = false;
  private container: HTMLElement;

  constructor(config: VrmSpikeConfig) {
    this.container = config.container;
    const w = config.width || this.container.clientWidth || 400;
    const h = config.height || this.container.clientHeight || 400;

    // 1. Escena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);

    // 2. Cámara (enfocando busto y brazos superiores, clave para lengua de señas)
    this.camera = new THREE.PerspectiveCamera(30.0, w / h, 0.1, 20.0);
    this.camera.position.set(0.0, 1.25, 2.2);

    // 3. Renderizador WebGL
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 4. Iluminación para resaltar anatomía de manos y rostro
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(1.0, 2.0, 1.5).normalize();
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.8);
    fillLight.position.set(-1.0, 1.0, 1.0).normalize();
    this.scene.add(fillLight);

    this.clock = new THREE.Clock();
  }

  /**
   * Carga un modelo VRM desde una URL o asset local
   */
  public async loadModel(url: string): Promise<VRM> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            reject(new Error('El archivo cargado no contiene metadatos VRM válidos.'));
            return;
          }

          // Optimización de rotación y mallas VRoid
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          vrm.scene.rotation.y = Math.PI; // Orientar hacia la cámara

          if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            VRMUtils.deepDispose(this.currentVrm.scene);
          }

          this.currentVrm = vrm;
          this.scene.add(vrm.scene);
          resolve(vrm);
        },
        (progress) => {
          console.log(`[VRM Spike] Cargando modelo: ${((progress.loaded / progress.total) * 100).toFixed(0)}%`);
        },
        (error) => {
          reject(error);
        }
      );
    });
  }

  /**
   * Inicia el bucle de renderizado y animación de prueba
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
        // Simulación de respiración y movimiento básico en cuello/cabeza
        const headNode = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
        if (headNode) {
          headNode.rotation.y = Math.sin(elapsed * 1.5) * 0.1;
        }

        // Simulación de articulación de brazo/mano derecha (postura de seña)
        const rightUpperArm = this.currentVrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
        if (rightUpperArm) {
          rightUpperArm.rotation.z = -1.2 + Math.sin(elapsed * 2) * 0.15;
          rightUpperArm.rotation.x = 0.5;
        }

        // Actualizar cinemática interna del VRM
        this.currentVrm.update(delta);
      }

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  public stop(): void {
    this.isAnimating = false;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    this.stop();
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
    }
    this.renderer.dispose();
  }
}
