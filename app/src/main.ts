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
import { mensajes, themes } from '../i18n/es-EC/mensajes';
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
const homeView = document.getElementById('home-view') as HTMLElement;
const practiceView = document.getElementById('practice-view') as HTMLElement;
const themesGrid = document.getElementById('tematicas-grid') as HTMLElement;
const practiceTitle = document.getElementById('practice-title') as HTMLElement;
const catalogNotice = document.getElementById('catalogo-notice') as HTMLElement;
const retryResources = document.getElementById('btn-retry-resources') as HTMLButtonElement;
const retryCatalog = document.getElementById('btn-retry-catalog') as HTMLButtonElement;
const backToThemes = document.getElementById('btn-volver-tematicas') as HTMLButtonElement;

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
anotadorDrawer.hidden = true;
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
const referenceRenderer = new SkeletonRenderer(
  document.getElementById('reference-skeleton-canvas') as HTMLCanvasElement
);
referenceRenderer.resize(640, 480);
const referenceStatus = document.getElementById('reference-status') as HTMLSpanElement;
const annotationService = new AnnotationService();
const catalogoService = new CatalogoPlayerService();

let avatarViewer: VrmAvatarViewer | null = null;
let avatarLoad: Promise<unknown> | null = null;
let visionLoad: Promise<void> | null = null;
let cameraLoad: Promise<MediaStream> | null = null;
let activeUnit: number | null = null;
let sessionId = 0;
let cameraRequest = 0;
let cameraOwner = 0;
let cameraOwnerRequest = 0;
let animationFrame: number | null = null;
const loadErrors = new Set<string>();

function currentSession(id: number): boolean {
  return activeUnit !== null && id === sessionId;
}

function resourceStatus(name: string, message: string, state: 'loading' | 'ready' | 'error'): void {
  const label = document.getElementById(`load-${name}`)!;
  label.textContent = message;
  label.dataset.state = state;
  if (state === 'error') loadErrors.add(name);
  else loadErrors.delete(name);
  retryResources.hidden = loadErrors.size === 0;
}

function renderThemes(): void {
  themesGrid.replaceChildren();
  themes.forEach(([name, description, icon], index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.unit = String(index + 1);
    const refs = catalogoService.getCatalog(index + 1);
    const demo = refs.length > 0 && refs.every((s) => catalogoService.isDemo(s));
    for (const [className, text] of [
      ['theme-icon', icon],
      ['theme-number', mensajes.unidad(String(index + 1).padStart(2, '0'))],
      ['theme-name', name],
      ['theme-description', description],
      [
        'theme-count',
        refs.length
          ? `${refs.length} ${demo ? (refs.length === 1 ? mensajes.demostracion : mensajes.demostraciones) : refs.length === 1 ? mensajes.sena : mensajes.senas}`
          : mensajes.referenciaPendiente,
      ],
      ['theme-action', mensajes.explorarTema],
    ]) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      if (className === 'theme-icon') span.setAttribute('aria-hidden', 'true');
      card.appendChild(span);
    }
    card.addEventListener('click', () => enterTheme(index + 1));
    themesGrid.appendChild(card);
  });
}

function refreshSelectedCatalog(): void {
  if (activeUnit === null) return;
  const senas = catalogoService.selectUnit(activeUnit);
  btnPlayerPlay.textContent = mensajes.reproducir;
  btnPlayerPlay.classList.remove('playing');
  selectCatalogoSena.innerHTML = '';
  selectCatalogoSena.disabled = senas.length === 0;
  if (!senas.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = mensajes.selectorVacio;
    selectCatalogoSena.appendChild(opt);
    fonologiaInfo.textContent = mensajes.referenciasProximamente;
    referenceStatus.textContent = mensajes.sinSeleccion;
    referenceRenderer.clear();
    avatarViewer?.resetPose();
    sliderPlayerProgress.value = '0';
    playerTimeDisplay.textContent = '0/0';
  }
  senas.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.glosa}${catalogoService.isDemo(s) ? mensajes.etiquetaDemostracion : ''}`;
    selectCatalogoSena.appendChild(opt);
  });
  selectCatalogoSena.value = senas[0]?.id ?? '';
  const failed = !catalogoService.getIsLoaded();
  catalogNotice.textContent = failed
    ? mensajes.errorCatalogo
    : !senas.length
      ? mensajes.temaVacio
      : senas.every((s) => catalogoService.isDemo(s))
        ? mensajes.catalogoDemo
        : mensajes.referenciasDisponibles(senas.length);
  retryCatalog.hidden = !failed;
  setAvatarDisplayMode(avatarDisplayMode);
  updateFonologiaDisplay();
}

async function loadCatalog(): Promise<void> {
  await catalogoService.loadCatalog();
  renderThemes();
  refreshSelectedCatalog();
}
renderThemes();
void loadCatalog();
retryCatalog.addEventListener('click', async () => {
  retryCatalog.disabled = true;
  try {
    await loadCatalog();
  } finally {
    retryCatalog.disabled = false;
  }
});

async function prepareAvatar(id: number): Promise<void> {
  resourceStatus('avatar', mensajes.avatarCargando, 'loading');
  try {
    avatarViewer ??= new VrmAvatarViewer({ container: avatarContainer });
    if (!avatarViewer.getVrm()) {
      avatarLoad ??= avatarViewer.loadModel(VRM_MODEL_URL).finally(() => {
        avatarLoad = null;
      });
      await avatarLoad;
    }
    if (!currentSession(id)) return;
    avatarLoading.classList.add('oculto');
    avatarViewer.start();
    resourceStatus('avatar', mensajes.avatarListo, 'ready');
  } catch (error) {
    if (!currentSession(id)) return;
    const message = error instanceof Error ? error.message : mensajes.recursoNoDisponible;
    resourceStatus('avatar', mensajes.avatarError(message), 'error');
    avatarLoading.querySelector('.avatar-loading-text')!.textContent = mensajes.errorAvatar;
  }
}

async function prepareVision(id: number): Promise<void> {
  resourceStatus('vision', mensajes.visionCargando, 'loading');
  try {
    if (!visionService.getReadyStatus()) {
      visionLoad ??= visionService.init().finally(() => {
        visionLoad = null;
      });
      await visionLoad;
    }
    if (currentSession(id)) resourceStatus('vision', mensajes.visionLista, 'ready');
  } catch (error) {
    if (!currentSession(id)) return;
    resourceStatus(
      'vision',
      mensajes.visionError(error instanceof Error ? error.message : mensajes.recursoNoDisponible),
      'error'
    );
  }
}

async function startCamera(id: number): Promise<void> {
  if (cameraLoad && cameraOwner === id && cameraOwnerRequest === cameraRequest) return;
  const request = ++cameraRequest;
  cameraOwner = id;
  cameraOwnerRequest = request;
  btnToggleCamera.disabled = true;
  resourceStatus('camera', mensajes.camaraPendiente, 'loading');
  try {
    if (cameraLoad) await cameraLoad.catch(() => {});
    if (!currentSession(id) || request !== cameraRequest) return;
    if (!cameraService.isRunning()) {
      cameraLoad = cameraService.start().finally(() => {
        cameraLoad = null;
      });
      await cameraLoad;
    }
    if (!currentSession(id) || request !== cameraRequest) {
      cameraService.stop();
      return;
    }
    isSimulating = false;
    btnToggleSynthetic.textContent = mensajes.activarSimulacion;
    btnToggleCamera.textContent = mensajes.apagarCamara;
    resourceStatus('camera', mensajes.camaraActiva, 'ready');
    statusDisplay.textContent = mensajes.camaraActiva;
    statusDisplay.className = 'status-indicator ready';
  } catch (error) {
    if (!currentSession(id) || request !== cameraRequest) return;
    resourceStatus(
      'camera',
      mensajes.camaraError(error instanceof Error ? error.message : mensajes.recursoNoDisponible),
      'error'
    );
    btnToggleCamera.textContent = mensajes.reintentarCamara;
    statusDisplay.textContent = mensajes.camaraNoDisponible;
    statusDisplay.className = 'status-indicator error';
  } finally {
    if (currentSession(id) && request === cameraRequest) btnToggleCamera.disabled = false;
  }
}

async function prepareResources(id: number): Promise<void> {
  await Promise.all([prepareAvatar(id), prepareVision(id), startCamera(id)]);
}

async function enterTheme(unit: number): Promise<void> {
  if (activeUnit !== null) return;
  activeUnit = unit;
  avatarDisplayMode = 'guia';
  const id = ++sessionId;
  homeView.hidden = true;
  practiceView.hidden = false;
  practiceTitle.textContent = themes[unit - 1][0];
  statusDisplay.textContent = mensajes.preparandoPractica;
  statusDisplay.className = 'status-indicator';
  practiceTitle.focus();
  selectUnidad.value = String(unit);
  lastTimestamp = performance.now();
  refreshSelectedCatalog();
  animationFrame = requestAnimationFrame(animationLoop);
  await prepareResources(id);
}

backToThemes.addEventListener('click', () => {
  if (annotationService.getIsRecording()) btnRecordSena.click();
  activeUnit = null;
  sessionId++;
  cameraRequest++;
  cameraService.stop();
  avatarViewer?.stop();
  avatarViewer?.resetPose();
  catalogoService.pause();
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  isSimulating = false;
  lastVideoTime = -1;
  lastDetection = { landmarks: {}, encuadreValido: false };
  frameCount = 0;
  fpsDisplay.textContent = mensajes.fpsInicial;
  statusDisplay.textContent = mensajes.elegirTema;
  statusDisplay.className = 'status-indicator';
  btnToggleSynthetic.textContent = mensajes.activarSimulacion;
  renderer.clear();
  encuadreBox?.classList.remove('valido');
  anotadorDrawer.classList.add('oculto');
  anotadorDrawer.hidden = true;
  tabAnotador.setAttribute('aria-expanded', 'false');
  tabPractica.classList.add('active');
  tabAnotador.classList.remove('active');
  practiceView.hidden = true;
  homeView.hidden = false;
  themesGrid.focus();
});
retryResources.addEventListener('click', () => prepareResources(sessionId));

function updateFonologiaDisplay(): void {
  const sena = catalogoService.getSelectedSena();
  if (sena) {
    const params = sena.parametros_fonologicos;
    const toponema = params.toponema_ubicacion.zona_corporal.replace('_', ' ');
    const kinesema = params.kinesema_movimiento.tipo_movimiento;
    const queirema = params.queirema_configuracion.codigo_forma.replaceAll('_', ' ');
    fonologiaInfo.textContent = mensajes.fonologia(
      toponema,
      kinesema,
      queirema,
      params.kinema_orientacion.vector_palma.join(', '),
      params.prosoponema_no_manual.requerido
    );
    sliderPlayerProgress.min = sena.segmentacion.frame_inicio_sena.toString();
    sliderPlayerProgress.max = sena.segmentacion.frame_fin_sena.toString();
    sliderPlayerProgress.value = catalogoService.getCurrentFrameIndex().toString();
    playerTimeDisplay.textContent = `${catalogoService.getCurrentFrameIndex()}/${sena.frames.length}`;
  }
}

selectCatalogoSena.addEventListener('change', () => {
  avatarViewer?.resetPose();
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
    btnPlayerPlay.textContent = mensajes.pausar;
    btnPlayerPlay.classList.add('playing');
  } else {
    btnPlayerPlay.textContent = mensajes.reproducir;
    btnPlayerPlay.classList.remove('playing');
  }
});

btnPlayerSpeed.addEventListener('click', () => {
  const currentSpeed = catalogoService.getSpeed();
  const nextSpeed = currentSpeed === 1.0 ? 0.5 : 1.0;
  catalogoService.setSpeed(nextSpeed);
  btnPlayerSpeed.textContent = `${nextSpeed.toFixed(1)}×`;
  btnPlayerSpeed.title = nextSpeed === 0.5 ? mensajes.velocidadLenta : mensajes.velocidadNormal;
});

sliderPlayerProgress.addEventListener('input', () => {
  if (avatarDisplayMode !== 'guia') return;
  const targetFrame = parseInt(sliderPlayerProgress.value);
  catalogoService.seekFrame(targetFrame);
  const sena = catalogoService.getSelectedSena();
  if (sena && sena.frames[targetFrame]) {
    const update = catalogoService.update(performance.now());
    if (update.landmarks) {
      avatarViewer?.updatePose(update.landmarks);
      referenceRenderer.render(update.landmarks);
    }
    playerTimeDisplay.textContent = `${targetFrame}/${sena.frames.length}`;
  }
});

btnPlayerRestart.addEventListener('click', () => {
  avatarViewer?.resetPose();
  catalogoService.seekFrame(0);
  catalogoService.play();
  btnPlayerPlay.textContent = mensajes.pausar;
  btnPlayerPlay.classList.add('playing');
});

// ─── Selector de Modo de Avatar (Guía vs Reflejo en Vivo) ───────────────────
function setAvatarDisplayMode(mode: 'guia' | 'espejo'): void {
  avatarDisplayMode = mode;
  avatarViewer?.resetPose();
  btnModeGuia.classList[mode === 'guia' ? 'add' : 'remove']('active');
  btnModeEspejo.classList[mode === 'espejo' ? 'add' : 'remove']('active');
  btnModeGuia.setAttribute('aria-pressed', String(mode === 'guia'));
  btnModeEspejo.setAttribute('aria-pressed', String(mode === 'espejo'));
  for (const control of [btnPlayerPlay, btnPlayerSpeed, btnPlayerRestart, sliderPlayerProgress])
    control.disabled = mode !== 'guia' || !catalogoService.getSelectedSena();
  if (mode === 'espejo') {
    catalogoService.pause();
    btnPlayerPlay.textContent = mensajes.reproducir;
    btnPlayerPlay.classList.remove('playing');
  }
}
btnModeGuia.addEventListener('click', () => setAvatarDisplayMode('guia'));
btnModeEspejo.addEventListener('click', () => setAvatarDisplayMode('espejo'));

// ─── Estado de la app ────────────────────────────────────────────────────────
let isSimulating = false;
let lastTimestamp = performance.now();
let frameCount = 0;
let currentFps = 0;
let lastVideoTime = -1;
let lastDetection: ReturnType<VisionService['detect']> = { landmarks: {}, encuadreValido: false };

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
  if (activeUnit === null) return;
  if (timestamp - lastTimestamp >= 1000) {
    currentFps = Math.round((frameCount * 1000) / (timestamp - lastTimestamp));
    fpsDisplay.textContent = mensajes.fps(currentFps);
    frameCount = 0;
    lastTimestamp = timestamp;
  }

  syncCanvasSize();

  let userLandmarks: HolisticFrameLandmarks = {};
  let freshFrame = isSimulating;

  // 1. Obtención de landmarks del usuario (cámara o simulación)
  if (isSimulating) {
    userLandmarks = renderer.generateSyntheticPose(timestamp);
    encuadreBox?.classList.add('valido');
  } else if (cameraService.isRunning()) {
    if (visionService.getReadyStatus()) {
      if (video.currentTime !== lastVideoTime) {
        freshFrame = true;
        lastDetection = visionService.detect(video, timestamp);
        lastVideoTime = video.currentTime;
      }
      const detection = lastDetection;
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

  if (freshFrame) frameCount++;

  // 2. Renderizado del espejo del usuario
  if (userLandmarks.pose || userLandmarks.rightHand || userLandmarks.leftHand) {
    renderer.render(userLandmarks);

    // Registro continuo si la grabación del anotador está activa
    if (annotationService.getIsRecording() && freshFrame) {
      annotationService.recordFrame(userLandmarks);
      const frames = annotationService.getRecordedFrames();
      const lastFrame = frames[frames.length - 1];
      const durSec = (lastFrame.timestamp_ms / 1000).toFixed(1);
      recordCounter.textContent = mensajes.cuadros(frames.length, durSec);
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
      avatarViewer?.updatePose(guideUpdate.landmarks);
      referenceRenderer.render(guideUpdate.landmarks);
      referenceStatus.textContent = guideUpdate.landmarks.isDemo
        ? mensajes.manoRespaldo
        : mensajes.esqueletoReferencia;
      sliderPlayerProgress.value = guideUpdate.frameIndex.toString();
      playerTimeDisplay.textContent = `${guideUpdate.frameIndex}/${guideUpdate.totalFrames}`;
    }
  } else {
    // MODO REFLEJO EN VIVO: el avatar actúa como espejo 3D del usuario en tiempo real
    if (userLandmarks.pose || userLandmarks.rightHand || userLandmarks.leftHand) {
      avatarViewer?.updatePose(userLandmarks);
    } else {
      avatarViewer?.updatePose({});
    }
  }

  animationFrame = requestAnimationFrame(animationLoop);
}

// ─── Control de cámara ───────────────────────────────────────────────────────
btnToggleCamera.addEventListener('click', async () => {
  if (activeUnit === null) return;
  if (cameraService.isRunning()) {
    cameraRequest++;
    cameraService.stop();
    lastVideoTime = -1;
    lastDetection = { landmarks: {}, encuadreValido: false };
    renderer.clear();
    encuadreBox?.classList.remove('valido');
    btnToggleCamera.textContent = mensajes.encenderCamara;
    resourceStatus('camera', mensajes.camaraDetenida, 'ready');
    statusDisplay.textContent = mensajes.camaraDetenida;
    statusDisplay.className = 'status-indicator';
  } else {
    await Promise.all([prepareVision(sessionId), startCamera(sessionId)]);
  }
});

// ─── Control de simulación sintética (Spike/Offline) ─────────────────────────
btnToggleSynthetic.addEventListener('click', () => {
  cameraRequest++;
  cameraService.stop();
  btnToggleCamera.disabled = false;
  btnToggleCamera.textContent = mensajes.encenderCamara;
  resourceStatus('camera', mensajes.camaraDetenida, 'ready');
  isSimulating = !isSimulating;
  if (isSimulating) {
    btnToggleSynthetic.textContent = mensajes.detenerSimulacion;
    statusDisplay.textContent = mensajes.simulacionActiva;
    statusDisplay.className = 'status-indicator ready';
  } else {
    btnToggleSynthetic.textContent = mensajes.activarSimulacion;
    statusDisplay.textContent = mensajes.espera;
    statusDisplay.className = 'status-indicator';
    renderer.clear();
  }
});

// ─── Lógica de Navegación Tabs & Drawer Anotador ──────────────────────────────
tabPractica.addEventListener('click', () => {
  if (activeUnit === null) void enterTheme(1);
  tabPractica.classList.add('active');
  tabAnotador.classList.remove('active');
  anotadorDrawer.classList.add('oculto');
  anotadorDrawer.hidden = true;
  tabAnotador.setAttribute('aria-expanded', 'false');
});

tabAnotador.addEventListener('click', () => {
  if (activeUnit === null) void enterTheme(1);
  tabAnotador.classList.add('active');
  tabPractica.classList.remove('active');
  anotadorDrawer.classList.remove('oculto');
  anotadorDrawer.hidden = false;
  tabAnotador.setAttribute('aria-expanded', 'true');
  btnCerrarAnotador.focus();
});

btnCerrarAnotador.addEventListener('click', () => {
  tabPractica.click();
  tabAnotador.focus();
});

// ─── Controles de Grabación de Seña ──────────────────────────────────────────
btnRecordSena.addEventListener('click', () => {
  if (!annotationService.getIsRecording()) {
    if (!cameraService.isRunning() && !isSimulating) {
      alert(mensajes.activarAntesDeGrabar);
      return;
    }
    annotationService.startRecording();
    btnRecordSena.textContent = mensajes.detenerGrabacion;
    btnRecordSena.classList.add('recording');
    recordStatus.textContent = mensajes.grabando;
    recordStatus.style.color = '#ef4444';
    exportMsg.textContent = '';
  } else {
    const stats = annotationService.stopRecording();
    btnRecordSena.textContent = mensajes.nuevaToma;
    btnRecordSena.classList.remove('recording');
    recordStatus.textContent = mensajes.tomaFinalizada(stats.totalFrames);
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
    exportMsg.textContent = mensajes.tomaObligatoria;
    exportMsg.className = 'export-msg error';
    return;
  }

  const glosa = inputGlosa.value.trim();
  if (!glosa) {
    exportMsg.textContent = mensajes.glosaObligatoria;
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
      prosoponemaRequerido: checkProsoponema.checked,
    });

    annotationService.downloadJson(doc);
    exportMsg.textContent = mensajes.referenciaExportada(doc.id);
    exportMsg.className = 'export-msg success';
  } catch (err: unknown) {
    const error = err as Error;
    exportMsg.textContent = mensajes.error(error.message);
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
