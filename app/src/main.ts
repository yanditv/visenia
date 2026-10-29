/**
 * Punto de entrada principal de la PWA Viseña — Espejo Digital + Avatar Guía + Catálogo + Anotador
 * Sprint 1
 *
 * Características:
 *  - Panel izquierdo: espejo de práctica con inferencia MediaPipe GPU (Pose + Manos + Rostro)
 *  - Panel derecho: avatar VRM (visenia.vrm) con cinemática Three.js
 *  - Catálogo y reproductor: reproduce señas de referencia a 1x y 0.5x
 *  - Anotador fonológico: captura, segmentación y exportación de referencias JSON schema v1.1.0
 */
import { CameraService } from './camera/camera-service';
import { SkeletonRenderer, HolisticFrameLandmarks } from './render/skeleton-renderer';
import { VisionService } from './vision/vision-service';
import { VrmAvatarViewer, VRM_MODEL_URL } from './avatar/vrm-loader-spike';
import { AnnotationService } from './anotador/annotation-service';
import { CatalogoPlayerService } from './catalogo/catalogo-service';

// ─── Referencias del DOM: Espejo y HUD ──────────────────────────────────────
const video = document.getElementById('webcam-video') as HTMLVideoElement;
const canvas = document.getElementById('skeleton-canvas') as HTMLCanvasElement;
const fpsDisplay = document.getElementById('fps-display') as HTMLSpanElement;
const statusDisplay = document.getElementById('status-display') as HTMLSpanElement;
const encuadreBox = document.querySelector('.encuadre-box') as HTMLDivElement;
const btnToggleCamera = document.getElementById('btn-toggle-camera') as HTMLButtonElement;
const btnToggleSynthetic = document.getElementById('btn-toggle-synthetic') as HTMLButtonElement;
const avatarContainer = document.getElementById('avatar-container') as HTMLDivElement;
const avatarLoading = document.getElementById('avatar-loading') as HTMLDivElement;

// ─── Referencias del DOM: Catálogo y Reproductor ────────────────────────────
const selectCatalogoSena = document.getElementById('select-catalogo-sena') as HTMLSelectElement;
const fonologiaInfo = document.getElementById('fonologia-info') as HTMLSpanElement;
const btnPlayerPlay = document.getElementById('btn-player-play') as HTMLButtonElement;
const btnPlayerSpeed = document.getElementById('btn-player-speed') as HTMLButtonElement;
const sliderPlayerProgress = document.getElementById('slider-player-progress') as HTMLInputElement;
const playerTimeDisplay = document.getElementById('player-time-display') as HTMLSpanElement;
const btnPlayerRestart = document.getElementById('btn-player-restart') as HTMLButtonElement;

// ─── Referencias del DOM: Selector de Modo de Avatar (Guía vs Reflejo en Vivo) ──
const btnModeGuia = document.getElementById('btn-mode-guia') as HTMLButtonElement;
const btnModeEspejo = document.getElementById('btn-mode-espejo') as HTMLButtonElement;
let avatarDisplayMode: 'guia' | 'espejo' = 'guia';

// ─── Referencias del DOM: Tabs y Drawer Anotador ────────────────────────────
const tabPractica = document.getElementById('tab-practica') as HTMLButtonElement;
const tabAnotador = document.getElementById('tab-anotador') as HTMLButtonElement;
const anotadorDrawer = document.getElementById('anotador-drawer') as HTMLElement;
const btnCerrarAnotador = document.getElementById('btn-cerrar-anotador') as HTMLButtonElement;
const btnRecordSena = document.getElementById('btn-record-sena') as HTMLButtonElement;
const recordStatus = document.getElementById('record-status') as HTMLSpanElement;
const recordCounter = document.getElementById('record-counter') as HTMLSpanElement;
const sliderFrameInicio = document.getElementById('slider-frame-inicio') as HTMLInputElement;
const sliderFrameFin = document.getElementById('slider-frame-fin') as HTMLInputElement;
const lblFrameInicio = document.getElementById('lbl-frame-inicio') as HTMLElement;
const lblFrameFin = document.getElementById('lbl-frame-fin') as HTMLElement;

const inputGlosa = document.getElementById('input-glosa') as HTMLInputElement;
const selectUnidad = document.getElementById('select-unidad') as HTMLInputElement;
const selectDificultad = document.getElementById('select-dificultad') as HTMLSelectElement;
const selectManoDom = document.getElementById('select-mano-dom') as HTMLSelectElement;
const selectToponema = document.getElementById('select-toponema') as HTMLSelectElement;
const selectKinesema = document.getElementById('select-kinesema') as HTMLSelectElement;
const inputQueirema = document.getElementById('input-queirema') as HTMLInputElement;
const checkProsoponema = document.getElementById('check-prosoponema') as HTMLInputElement;
const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;
const exportMsg = document.getElementById('export-msg') as HTMLSpanElement;

// ─── Servicios ───────────────────────────────────────────────────────────────
const cameraService = new CameraService(video);
const renderer = new SkeletonRenderer(canvas);
const visionService = new VisionService();
const annotationService = new AnnotationService();
const catalogoService = new CatalogoPlayerService();

// ─── Avatar VRM (Three.js + Kalidokit) ──────────────────────────────────────
const avatarViewer = new VrmAvatarViewer({ container: avatarContainer });

// Cargar el modelo VRM de forma asíncrona al iniciar la página
avatarViewer
  .loadModel(VRM_MODEL_URL)
  .then(() => {
    avatarLoading.classList.add('oculto');
    avatarViewer.start();
    console.log('[main] ✓ Avatar VRM listo y animando.');
  })
  .catch((err) => {
    console.error('[main] Error al cargar avatar VRM:', err);
    avatarLoading.querySelector('.avatar-loading-text')!.textContent = 'Error al cargar avatar';
  });

// ─── Inicialización del Catálogo de Señas ───────────────────────────────────
catalogoService.loadCatalog().then((senas) => {
  selectCatalogoSena.innerHTML = '';
  if (senas.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Sin señas disponibles';
    selectCatalogoSena.appendChild(opt);
    return;
  }

  senas.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.glosa} (Unidad ${s.unidad_tematica} • ${s.dificultad})`;
    selectCatalogoSena.appendChild(opt);
  });

  updateFonologiaDisplay();
});

function updateFonologiaDisplay(): void {
  const sena = catalogoService.getSelectedSena();
  if (sena) {
    const params = sena.parametros_fonologicos;
    const toponema = params.toponema_ubicacion.zona_corporal.replace('_', ' ');
    const kinesema = params.kinesema_movimiento.tipo_movimiento;
    const queirema = params.queirema_configuracion.codigo_forma.replace('_', ' ');
    fonologiaInfo.textContent = `Toponema: ${toponema} • Mov: ${kinesema} • Forma: ${queirema}`;
    sliderPlayerProgress.max = (sena.frames.length - 1).toString();
    sliderPlayerProgress.value = '0';
    playerTimeDisplay.textContent = `0/${sena.frames.length}`;
  }
}

selectCatalogoSena.addEventListener('change', () => {
  catalogoService.selectSena(selectCatalogoSena.value);
  updateFonologiaDisplay();
  if (catalogoService.getIsPlaying()) {
    catalogoService.play();
  }
});

// ─── Controles del Reproductor ──────────────────────────────────────────────
btnPlayerPlay.addEventListener('click', () => {
  const isNowPlaying = catalogoService.togglePlay();
  if (isNowPlaying) {
    btnPlayerPlay.textContent = '⏸ Pausar';
    btnPlayerPlay.classList.add('playing');
  } else {
    btnPlayerPlay.textContent = '▶ Reproducir';
    btnPlayerPlay.classList.remove('playing');
  }
});

btnPlayerSpeed.addEventListener('click', () => {
  const currentSpeed = catalogoService.getSpeed();
  const nextSpeed = currentSpeed === 1.0 ? 0.5 : 1.0;
  catalogoService.setSpeed(nextSpeed);
  btnPlayerSpeed.textContent = `${nextSpeed.toFixed(1)}×`;
  btnPlayerSpeed.title = nextSpeed === 0.5 ? 'Velocidad Lenta (0.5x)' : 'Velocidad Normal (1.0x)';
});

sliderPlayerProgress.addEventListener('input', () => {
  const targetFrame = parseInt(sliderPlayerProgress.value);
  catalogoService.seekFrame(targetFrame);
  const sena = catalogoService.getSelectedSena();
  if (sena && sena.frames[targetFrame]) {
    const update = catalogoService.update(performance.now());
    if (update.landmarks) {
      avatarViewer.updatePose(update.landmarks);
    }
    playerTimeDisplay.textContent = `${targetFrame}/${sena.frames.length}`;
  }
});

btnPlayerRestart.addEventListener('click', () => {
  catalogoService.seekFrame(0);
  catalogoService.play();
  btnPlayerPlay.textContent = '⏸ Pausar';
  btnPlayerPlay.classList.add('playing');
});

// ─── Selector de Modo de Avatar (Guía vs Reflejo en Vivo) ───────────────────
btnModeGuia?.addEventListener('click', () => {
  avatarDisplayMode = 'guia';
  btnModeGuia.classList.add('active');
  btnModeEspejo.classList.remove('active');
  const update = catalogoService.update(performance.now());
  if (update.landmarks) {
    avatarViewer.updatePose(update.landmarks);
  }
});

btnModeEspejo?.addEventListener('click', () => {
  avatarDisplayMode = 'espejo';
  btnModeEspejo.classList.add('active');
  btnModeGuia.classList.remove('active');
});

// ─── Estado de la app ────────────────────────────────────────────────────────
let isSimulating = false;
let lastTimestamp = performance.now();
let frameCount = 0;
let currentFps = 0;

// ─── Ajuste dinámico del canvas del espejo ───────────────────────────────────
function syncCanvasSize() {
  if (video.videoWidth && video.videoHeight) {
    renderer.resize(video.videoWidth, video.videoHeight);
  } else {
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
  }
}

window.addEventListener('resize', syncCanvasSize);

// ─── Bucle de renderizado principal (RAF) ────────────────────────────────────
function animationLoop(timestamp: number) {
  frameCount++;
  if (timestamp - lastTimestamp >= 1000) {
    currentFps = Math.round((frameCount * 1000) / (timestamp - lastTimestamp));
    fpsDisplay.textContent = `FPS: ${currentFps}`;
    frameCount = 0;
    lastTimestamp = timestamp;
  }

  syncCanvasSize();

  let userLandmarks: HolisticFrameLandmarks = {};

  // 1. Obtención de landmarks del usuario (cámara o simulación)
  if (isSimulating) {
    userLandmarks = renderer.generateSyntheticPose(timestamp);
    encuadreBox?.classList.add('valido');
  } else if (cameraService.isRunning()) {
    if (visionService.getReadyStatus()) {
      const detection = visionService.detect(video, timestamp);
      userLandmarks = detection.landmarks;

      if (detection.encuadreValido) {
        encuadreBox?.classList.add('valido');
      } else {
        encuadreBox?.classList.remove('valido');
      }
    } else {
      encuadreBox?.classList.remove('valido');
    }
  } else {
    renderer.clear();
    encuadreBox?.classList.remove('valido');
  }

  // 2. Renderizado del espejo del usuario
  if (userLandmarks.pose || userLandmarks.rightHand || userLandmarks.leftHand) {
    renderer.render(userLandmarks);

    // Registro continuo si la grabación del anotador está activa
    if (annotationService.getIsRecording()) {
      annotationService.recordFrame(userLandmarks);
      const frames = annotationService.getRecordedFrames();
      const lastFrame = frames[frames.length - 1];
      const durSec = (lastFrame.timestamp_ms / 1000).toFixed(1);
      recordCounter.textContent = `Frames: ${frames.length} | ${durSec}s`;
    }
  } else {
    renderer.clear();
  }

  // 3. Control de animación del Avatar 3D (Modo Guía vs Modo Reflejo en Vivo)
  if (avatarDisplayMode === 'guia') {
    // MODO GUÍA: el avatar demuestra la seña de referencia canónica del catálogo.
    // NUNCA es sobreescrito por la cámara del usuario mientras esté en modo guía.
    const guideUpdate = catalogoService.update(timestamp);
    if (guideUpdate.landmarks) {
      avatarViewer.updatePose(guideUpdate.landmarks);
      sliderPlayerProgress.value = guideUpdate.frameIndex.toString();
      playerTimeDisplay.textContent = `${guideUpdate.frameIndex}/${guideUpdate.totalFrames}`;
    }
  } else {
    // MODO REFLEJO EN VIVO: el avatar actúa como espejo 3D del usuario en tiempo real
    if (userLandmarks.pose || userLandmarks.rightHand || userLandmarks.leftHand) {
      avatarViewer.updatePose(userLandmarks);
    } else {
      avatarViewer.updatePose({});
    }
  }

  void requestAnimationFrame(animationLoop);
}

// Iniciar bucle del espejo
void requestAnimationFrame(animationLoop);

// ─── Control de cámara ───────────────────────────────────────────────────────
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

// ─── Control de simulación sintética (Spike/Offline) ─────────────────────────
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

// ─── Lógica de Navegación Tabs & Drawer Anotador ──────────────────────────────
tabPractica.addEventListener('click', () => {
  tabPractica.classList.add('active');
  tabAnotador.classList.remove('active');
  anotadorDrawer.classList.add('oculto');
});

tabAnotador.addEventListener('click', () => {
  tabAnotador.classList.add('active');
  tabPractica.classList.remove('active');
  anotadorDrawer.classList.remove('oculto');
});

btnCerrarAnotador.addEventListener('click', () => {
  tabPractica.click();
});

// ─── Controles de Grabación de Seña ──────────────────────────────────────────
btnRecordSena.addEventListener('click', () => {
  if (!annotationService.getIsRecording()) {
    if (!cameraService.isRunning() && !isSimulating) {
      alert('Por favor enciende la cámara o activa el Modo Simulación antes de grabar.');
      return;
    }
    annotationService.startRecording();
    btnRecordSena.textContent = '⏹ Detener Grabación';
    btnRecordSena.classList.add('recording');
    recordStatus.textContent = 'Grabando...';
    recordStatus.style.color = '#ef4444';
    exportMsg.textContent = '';
  } else {
    const stats = annotationService.stopRecording();
    btnRecordSena.textContent = '⏺ Grabar Nueva Toma';
    btnRecordSena.classList.remove('recording');
    recordStatus.textContent = `Grabación finalizada (${stats.totalFrames} frames)`;
    recordStatus.style.color = '#22c55e';

    const maxIdx = Math.max(0, stats.totalFrames - 1);
    sliderFrameInicio.max = maxIdx.toString();
    sliderFrameFin.max = maxIdx.toString();
    sliderFrameInicio.value = '0';
    sliderFrameFin.value = maxIdx.toString();
    lblFrameInicio.textContent = '0';
    lblFrameFin.textContent = maxIdx.toString();
  }
});

sliderFrameInicio.addEventListener('input', () => {
  lblFrameInicio.textContent = sliderFrameInicio.value;
  if (parseInt(sliderFrameInicio.value) > parseInt(sliderFrameFin.value)) {
    sliderFrameFin.value = sliderFrameInicio.value;
    lblFrameFin.textContent = sliderFrameInicio.value;
  }
});

sliderFrameFin.addEventListener('input', () => {
  lblFrameFin.textContent = sliderFrameFin.value;
  if (parseInt(sliderFrameFin.value) < parseInt(sliderFrameInicio.value)) {
    sliderFrameInicio.value = sliderFrameFin.value;
    lblFrameInicio.textContent = sliderFrameFin.value;
  }
});

// ─── Exportación de JSON Schema v1.1.0 ───────────────────────────────────────
btnExportJson.addEventListener('click', () => {
  const recorded = annotationService.getRecordedFrames();
  if (recorded.length === 0) {
    exportMsg.textContent = '⚠️ Primero debes grabar una toma con frames válidos.';
    exportMsg.className = 'export-msg error';
    return;
  }

  const glosa = inputGlosa.value.trim();
  if (!glosa) {
    exportMsg.textContent = '⚠️ La glosa de la seña es obligatoria.';
    exportMsg.className = 'export-msg error';
    return;
  }

  try {
    const doc = annotationService.buildReferenceDocument({
      glosa,
      unidadTematica: parseInt(selectUnidad.value) || 1,
      dificultad: selectDificultad.value as 'facil' | 'intermedio' | 'avanzado',
      manoDominante: selectManoDom.value as 'derecha' | 'izquierda' | 'ambas',
      anotador: 'Especialista LSE Viseña',
      frameInicioSena: parseInt(sliderFrameInicio.value),
      frameFinSena: parseInt(sliderFrameFin.value),
      queiremaForma: inputQueirema.value.trim() || 'mano_plana',
      queiremaDesc: 'Configuración manual base anotada',
      kinemaPalma: [0.0, 1.0, 0.0],
      toponemaZona: selectToponema.value as any,
      kinesemaTipo: selectKinesema.value as any,
      kinesemaRepeticiones: 1,
      prosoponemaRequerido: checkProsoponema.checked
    });

    annotationService.downloadJson(doc);
    exportMsg.textContent = `✓ Referencia ${doc.id}.json exportada correctamente.`;
    exportMsg.className = 'export-msg success';
  } catch (err: unknown) {
    const error = err as Error;
    exportMsg.textContent = `Error: ${error.message}`;
    exportMsg.className = 'export-msg error';
  }
});

// ─── Registro de Service Worker para PWA (offline) ───────────────────────────
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] Service Worker no registrado (modo dev local):', err);
    });
  });
}
