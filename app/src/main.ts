/**
 * Punto de entrada principal de la PWA Viseña - Espejo Digital (Semana 0 / RF-01, RF-02)
 */
import { CameraService } from './camera/camera-service';
import { SkeletonRenderer, HolisticFrameLandmarks } from './render/skeleton-renderer';

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

let isSimulating = false;
let animationFrameId: number | null = null;
let lastTimestamp = performance.now();
let frameCount = 0;
let currentFps = 0;

// Ajuste dinámico de dimensiones de Canvas
function syncCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
}

window.addEventListener('resize', syncCanvasSize);

// Bucle de renderizado
function animationLoop(timestamp: number) {
  // Cálculo de FPS en vivo
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
    // Si la cámara está activa sin modelo WASM pesado descargado aún en modo offline,
    // renderizamos landmarks base o esperamos detección
    landmarks = renderer.generateSyntheticPose(timestamp);
    encuadreBox?.classList.add('valido');
  } else {
    renderer.clear();
    encuadreBox?.classList.remove('valido');
  }

  if (landmarks.pose || landmarks.rightHand || landmarks.leftHand) {
    renderer.render(landmarks);
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
    } else {
      isSimulating = false;
      btnToggleSynthetic.textContent = 'Modo Simulación (Spike)';
      statusDisplay.textContent = 'Solicitando acceso...';

      await cameraService.start();

      btnToggleCamera.textContent = 'Apagar Cámara';
      btnToggleCamera.classList.remove('btn-primary');
      btnToggleCamera.classList.add('btn-secondary');
      statusDisplay.textContent = 'Cámara Activa (60 FPS)';
      statusDisplay.className = 'status-indicator ready';
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
