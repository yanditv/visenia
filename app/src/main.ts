/**
 * Punto de entrada principal de la PWA Viseña - Espejo Digital (Semana 0 / RF-01, RF-02)
 */
import { CameraService } from './camera/camera-service';
import { SkeletonRenderer, HolisticFrameLandmarks } from './render/skeleton-renderer';
import { VisionService } from './vision/vision-service';

// Referencias del DOM
const video = document.getElementById('webcam-video') as HTMLVideoElement;
const canvas = document.getElementById('skeleton-canvas') as HTMLCanvasElement;
const fpsDisplay = document.getElementById('fps-display') as HTMLSpanElement;
const statusDisplay = document.getElementById('status-display') as HTMLSpanElement;
const encuadreBox = document.querySelector('.encuadre-box') as HTMLDivElement;
const btnToggleCamera = document.getElementById('btn-toggle-camera') as HTMLButtonElement;
const btnToggleSynthetic = document.getElementById('btn-toggle-synthetic') as HTMLButtonElement;

const cameraService = new CameraService(video);
const renderer = new SkeletonRenderer(canvas);
const visionService = new VisionService();

let isSimulating = false;
let animationFrameId: number | null = null;
let lastTimestamp = performance.now();
let frameCount = 0;
let currentFps = 0;

// Ajuste dinámico de dimensiones de Canvas
function syncCanvasSize() {
  if (video.videoWidth && video.videoHeight) {
    renderer.resize(video.videoWidth, video.videoHeight);
  } else {
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
  }
}

window.addEventListener('resize', syncCanvasSize);

// Bucle de renderizado en tiempo real
function animationLoop(timestamp: number) {
  // Cálculo de FPS
  frameCount++;
  if (timestamp - lastTimestamp >= 1000) {
    currentFps = Math.round((frameCount * 1000) / (timestamp - lastTimestamp));
    fpsDisplay.textContent = `FPS: ${currentFps}`;
    frameCount = 0;
    lastTimestamp = timestamp;
  }

  syncCanvasSize();

  let landmarks: HolisticFrameLandmarks = {};

  if (isSimulating) {
    landmarks = renderer.generateSyntheticPose(timestamp);
    encuadreBox?.classList.add('valido');
  } else if (cameraService.isRunning()) {
    if (visionService.getReadyStatus()) {
      const detection = visionService.detect(video, timestamp);
      landmarks = detection.landmarks;

      if (detection.encuadreValido) {
        encuadreBox?.classList.add('valido');
      } else {
        encuadreBox?.classList.remove('valido');
      }
    } else {
      // Mientras cargan los modelos WASM
      encuadreBox?.classList.remove('valido');
    }
  } else {
    renderer.clear();
    encuadreBox?.classList.remove('valido');
  }

  if (landmarks.pose || landmarks.rightHand || landmarks.leftHand) {
    renderer.render(landmarks);
  } else {
    renderer.clear();
  }

  animationFrameId = requestAnimationFrame(animationLoop);
}

// Iniciar bucle
animationFrameId = requestAnimationFrame(animationLoop);

// Control de cámara
btnToggleCamera.addEventListener('click', async () => {
  try {
    if (cameraService.isRunning()) {
      cameraService.stop();
      btnToggleCamera.textContent = 'Encender Cámara';
      btnToggleCamera.classList.remove('btn-secondary');
      btnToggleCamera.classList.add('btn-primary');
      statusDisplay.textContent = 'Cámara detenida';
      statusDisplay.className = 'status-indicator';
      renderer.clear();
      encuadreBox?.classList.remove('valido');
    } else {
      isSimulating = false;
      btnToggleSynthetic.textContent = 'Modo Simulación (Spike)';
      statusDisplay.textContent = 'Iniciando cámara...';

      await cameraService.start();

      btnToggleCamera.textContent = 'Apagar Cámara';
      btnToggleCamera.classList.remove('btn-primary');
      btnToggleCamera.classList.add('btn-secondary');

      statusDisplay.textContent = 'Cargando modelos MediaPipe...';
      statusDisplay.className = 'status-indicator';

      // Inicializar inferencia en GPU
      try {
        await visionService.init();
        statusDisplay.textContent = 'Seguimiento Activo (GPU)';
        statusDisplay.className = 'status-indicator ready';
      } catch (modelErr) {
        statusDisplay.textContent = 'Cámara activa (error al cargar modelo)';
        statusDisplay.className = 'status-indicator error';
        console.error(modelErr);
      }
    }
  } catch (err: unknown) {
    const error = err as Error;
    statusDisplay.textContent = error.message;
    statusDisplay.className = 'status-indicator error';
    console.error('[Viseña Cámara Error]', error);
  }
});

// Control de simulación sintética (Spike/Offline)
btnToggleSynthetic.addEventListener('click', () => {
  if (cameraService.isRunning()) {
    cameraService.stop();
    btnToggleCamera.textContent = 'Encender Cámara';
    btnToggleCamera.classList.add('btn-primary');
    btnToggleCamera.classList.remove('btn-secondary');
  }

  isSimulating = !isSimulating;
  if (isSimulating) {
    btnToggleSynthetic.textContent = 'Detener Simulación';
    statusDisplay.textContent = 'Modo Simulación Activo';
    statusDisplay.className = 'status-indicator ready';
  } else {
    btnToggleSynthetic.textContent = 'Modo Simulación (Spike)';
    statusDisplay.textContent = 'En espera';
    statusDisplay.className = 'status-indicator';
    renderer.clear();
  }
});

// Registro de Service Worker para PWA (offline capability)
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] Service Worker no registrado (modo dev local):', err);
    });
  });
}
