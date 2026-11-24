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
import { mapa, mensajes, themes } from '../i18n/es-EC/mensajes';
import { renderLevelMap } from './catalogo/mapa';
import { renderThemes } from './catalogo/tematicas';
import { CameraService } from './camera/camera-service';
import { SkeletonRenderer, HolisticFrameLandmarks } from './render/skeleton-renderer';
import type { VisionService } from './vision/vision-service';
import type { VrmAvatarViewer } from './avatar/vrm-avatar-viewer';
import { AnnotationService } from './anotador/annotation-service';
import { createAnnotationPanel } from './anotador/annotation-panel';
import { instalarHistorial } from './progreso/historial';
import { instalarTrayectoria } from './progreso/trayectoria';
import { VistaResultado } from './practica/resultado';
import { PracticaLsec } from './practica/practica-lsec';
import type { IdReferencia } from '../../../contracts/typescript/visena-lsec.types';
import { CatalogoPlayerService } from './catalogo/catalogo-service';

// ─── Referencias del DOM: Espejo y HUD ──────────────────────────────────────
const video = document.getElementById('webcam-video') as HTMLVideoElement;
const canvas = document.getElementById('skeleton-canvas') as HTMLCanvasElement;
const fpsDisplay = document.getElementById('fps-display') as HTMLSpanElement;
const statusDisplay = document.getElementById('status-display') as HTMLSpanElement;
const encuadreBox = document.querySelector('.encuadre-box') as HTMLDivElement;
const avisoEncuadre = document.querySelector<HTMLElement>('.frame-waiting')!;
const avisoEncuadreInicial = avisoEncuadre.textContent;
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
const mapView = document.getElementById('map-view')!;
mapView.hidden = true;
const mapTitle = document.getElementById('map-title')!;
const mapRetry = document.getElementById('btn-retry-levels')!;
const avatarSource = document.getElementById('avatar-source')!;
let mapUnit: number | null = null;
let catalogLoading = true;

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

// ─── Servicios ───────────────────────────────────────────────────────────────
instalarHistorial(document, window);
const cameraService = new CameraService(video);
const renderer = new SkeletonRenderer(canvas);
const referenceRenderer = new SkeletonRenderer(
  document.getElementById('reference-skeleton-canvas') as HTMLCanvasElement
);
referenceRenderer.resize(640, 480);
const referenceStatus = document.getElementById('reference-status') as HTMLSpanElement;
const annotation = createAnnotationPanel(document, new AnnotationService(), {
  ensurePractice: () => {
    if (activeUnit === null) void enterTheme(mapUnit ?? 1);
  },
  canRecord: () =>
    isSimulating ||
    (cameraService.isRunning() && visionService?.getReadyStatus() === true && !visionFaulted),
});
const catalogoService = new CatalogoPlayerService();
const probarSena = document.getElementById('probar-sena') as HTMLButtonElement;
const practicaLsec = new PracticaLsec(
  probarSena,
  document.getElementById('resultado-lsec')!,
  new VistaResultado(document)
);
const reconocimientoLibre = document.getElementById('reconocimiento-libre') as HTMLInputElement;
const manoPreferida = document.getElementById('preferred-hand') as HTMLSelectElement;
reconocimientoLibre.addEventListener('change', () => practicaLsec.cancelar());
probarSena.addEventListener('click', () => {
  const ref = catalogoService.getNivel();
  const mano = manoPreferida.value;
  return practicaLsec.activar(
    cameraService.isRunning() &&
      !isSimulating &&
      visionService?.getReadyStatus() === true &&
      !visionFaulted,
    video.videoWidth,
    video.videoHeight,
    ref && !reconocimientoLibre.checked && !catalogoService.isDemo(ref)
      ? (ref.id as IdReferencia)
      : undefined,
    mano === 'izquierda' || mano === 'derecha' ? mano : undefined
  );
});
window.addEventListener(
  'visibilitychange',
  () => {
    if (document.hidden) practicaLsec.cancelar();
  },
  true
);

let avatarViewer: VrmAvatarViewer | null = null;
let visionService: VisionService | null = null;
let avatarLoad: Promise<unknown> | null = null;
let visionLoad: Promise<void> | null = null;
let visionFaulted = false;
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
  document.querySelector<HTMLElement>('.resource-panel')!.dataset.ready = String(
    ['avatar', 'vision', 'camera'].every(
      (resource) => document.getElementById(`load-${resource}`)!.dataset.state === 'ready'
    )
  );
}

let mejoresNotas: ReadonlyMap<string, number> = new Map();

function refreshThemes(): void {
  renderThemes(
    document,
    (unit) => catalogoService.getCatalog(unit),
    mejoresNotas,
    (unit, referenceId) => showMap(unit, true, referenceId)
  );
}

function refreshSelectedCatalog(referenceId?: string): void {
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
  if (referenceId && senas.some((nivel) => nivel.id === referenceId))
    catalogoService.selectSena(referenceId);
  selectCatalogoSena.value = catalogoService.getNivel()?.id ?? '';
  const failed = !catalogoService.getIsLoaded();
  catalogNotice.textContent = failed
    ? mensajes.errorCatalogo
    : !senas.length
      ? mensajes.temaVacio
      : senas.every((s) => catalogoService.isDemo(s))
        ? mensajes.catalogoDemo
        : mensajes.referenciasDisponibles(senas.length);
  retryCatalog.hidden = !failed;
  void actualizarGuia();
}

async function loadCatalog(): Promise<void> {
  catalogLoading = true;
  const selected = catalogoService.getNivel()?.id;
  await catalogoService.loadCatalog();
  catalogLoading = false;
  refreshThemes();
  refreshSelectedCatalog(selected);
  if (mapUnit !== null && activeUnit === null) showMap(mapUnit, false);
}

function showMap(unit: number, focus = true, referenceId?: string): void {
  mapUnit = unit;
  homeView.hidden = true;
  practiceView.hidden = true;
  mapView.hidden = false;
  renderLevelMap(
    document,
    unit,
    catalogoService.getCatalog(unit),
    (reference) => catalogoService.isDemo(reference),
    (referenceId) => enterTheme(unit, referenceId),
    referenceId ?? (focus ? catalogoService.getSelectedSena()?.id : undefined),
    mejoresNotas,
    !focus
  );
  mapRetry.hidden = catalogLoading || catalogoService.getIsLoaded();
  if (focus) mapTitle.focus();
}

function showHome() {
  mapUnit = null;
  mapView.hidden = true;
  homeView.hidden = false;
}

function openThemes() {
  if (activeUnit !== null) backToThemes.click();
  showHome();
  themesGrid.focus();
}

document.getElementById('btn-map-home')!.addEventListener('click', openThemes);
document.getElementById('nav-themes')!.addEventListener('click', openThemes);
document.getElementById('nav-home')!.addEventListener('click', () => {
  if (activeUnit !== null) backToThemes.click();
  showHome();
  document.getElementById('home-title')!.focus();
});
mapRetry.addEventListener('click', async () => {
  mapRetry.setAttribute('disabled', '');
  try {
    await loadCatalog();
  } finally {
    mapRetry.removeAttribute('disabled');
  }
});
instalarTrayectoria(document, window, (notas) => {
  mejoresNotas = notas;
  refreshThemes();
  if (mapUnit !== null && activeUnit === null) showMap(mapUnit, false);
});
refreshThemes();
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
    const { VrmAvatarViewer, VRM_MODEL_URL } = await import('./avatar/vrm-avatar-viewer');
    if (!currentSession(id)) return;
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
    if (!visionService) {
      const { VisionService } = await import('./vision/vision-service');
      if (!currentSession(id)) return;
      visionService ??= new VisionService();
    }
    if (!visionService.getReadyStatus()) {
      visionLoad ??= visionService.init().finally(() => {
        visionLoad = null;
      });
      await visionLoad;
    }
    if (currentSession(id)) {
      visionFaulted = false;
      visionService?.resetTracking();
      lastVideoTime = -1;
      resourceStatus('vision', mensajes.visionLista, 'ready');
    }
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
      visionService?.resetTracking();
      lastVideoTime = -1;
      lastDetection = { landmarks: {}, encuadreValido: false };
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
    statusDisplay.className = 'status-indicator camera-status ready';
  } catch (error) {
    if (!currentSession(id) || request !== cameraRequest) return;
    resourceStatus(
      'camera',
      mensajes.camaraError(error instanceof Error ? error.message : mensajes.recursoNoDisponible),
      'error'
    );
    btnToggleCamera.textContent = mensajes.reintentarCamara;
    statusDisplay.textContent = mensajes.camaraNoDisponible;
    statusDisplay.className = 'status-indicator camera-status error';
  } finally {
    if (currentSession(id) && request === cameraRequest) btnToggleCamera.disabled = false;
  }
}

async function prepareResources(id: number): Promise<void> {
  await Promise.all([prepareAvatar(id), prepareVision(id), startCamera(id)]);
}

async function enterTheme(unit: number, referenceId?: string): Promise<void> {
  if (activeUnit !== null) return;
  activeUnit = unit;
  avatarDisplayMode = 'guia';
  const id = ++sessionId;
  homeView.hidden = true;
  mapView.hidden = true;
  practiceView.hidden = false;
  practiceTitle.textContent = themes[unit - 1][0];
  statusDisplay.textContent = mensajes.preparandoPractica;
  statusDisplay.className = 'status-indicator camera-status';
  practiceTitle.focus();
  annotation.setUnit(unit);
  lastTimestamp = performance.now();
  refreshSelectedCatalog(referenceId);
  animationFrame = requestAnimationFrame(animationLoop);
  await prepareResources(id);
}

backToThemes.addEventListener('click', () => {
  const unit = activeUnit ?? mapUnit ?? 1;
  const referenceId = catalogoService.getNivel()?.id;
  practicaLsec.cancelar();
  annotation.finish();
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
  statusDisplay.className = 'status-indicator camera-status';
  btnToggleSynthetic.textContent = mensajes.activarSimulacion;
  renderer.clear();
  encuadreBox?.classList.remove('valido');
  annotation.close();
  practiceView.hidden = true;
  showMap(unit, true, referenceId);
});
retryResources.addEventListener('click', () => prepareResources(sessionId));

function updateFonologiaDisplay(): void {
  const sena = catalogoService.getSelectedSena();
  if (sena) {
    const params = sena.parametros_fonologicos;
    fonologiaInfo.textContent = params
      ? mensajes.fonologia(
          params.toponema_ubicacion.zona_corporal.replace('_', ' '),
          params.kinesema_movimiento.tipo_movimiento,
          params.queirema_configuracion.codigo_forma.replaceAll('_', ' '),
          params.kinema_orientacion.vector_palma.join(', '),
          params.prosoponema_no_manual.requerido
        )
      : 'Guía experimental. Anotación fonológica pendiente.';
    sliderPlayerProgress.min = sena.segmentacion.frame_inicio_sena.toString();
    sliderPlayerProgress.max = sena.segmentacion.frame_fin_sena.toString();
    sliderPlayerProgress.value = catalogoService.getCurrentFrameIndex().toString();
    playerTimeDisplay.textContent = `${catalogoService.getCurrentFrameIndex()}/${sena.frames.length}`;
  }
}

async function actualizarGuia() {
  const nivel = catalogoService.getNivel();
  const sesion = sessionId;
  reconocimientoLibre.disabled = !nivel || catalogoService.isDemo(nivel);
  reconocimientoLibre.checked = reconocimientoLibre.disabled;
  setAvatarDisplayMode(avatarDisplayMode);
  if (nivel && 'estado' in nivel) {
    referenceRenderer.clear();
    playerTimeDisplay.textContent = '0/0';
    referenceStatus.textContent = 'Cargando guía…';
    fonologiaInfo.textContent = '';
    try {
      await catalogoService.cargarGuia();
    } catch {
      if (currentSession(sesion) && catalogoService.getNivel() === nivel) {
        referenceStatus.textContent = 'No se pudo cargar la guía. Vuelve a intentar.';
        retryCatalog.hidden = false;
      }
      return;
    }
    if (!currentSession(sesion) || catalogoService.getNivel() !== nivel) return;
    setAvatarDisplayMode(avatarDisplayMode);
  }
  updateFonologiaDisplay();
}

selectCatalogoSena.addEventListener('change', () => {
  practicaLsec.cancelar();
  avatarViewer?.resetPose();
  catalogoService.selectSena(selectCatalogoSena.value);
  void actualizarGuia();
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
  const speeds = [1, 0.75, 0.5];
  const nextSpeed = speeds[(speeds.indexOf(currentSpeed) + 1) % speeds.length];
  catalogoService.setSpeed(nextSpeed);
  btnPlayerSpeed.textContent = `${nextSpeed.toLocaleString('es-EC')}×`;
  btnPlayerSpeed.title = mapa.velocidad(nextSpeed);
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
  avatarSource.textContent = mode === 'guia' ? mapa.modoGuia : mapa.modoEspejo;
  document.getElementById('reference-skeleton-canvas')!.closest('figure')!.hidden =
    mode === 'espejo';
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
let lastDetectionAt = -Infinity;
let lastDetection: ReturnType<VisionService['detect']> = { landmarks: {}, encuadreValido: false };

// ─── Ajuste dinámico del canvas del espejo ───────────────────────────────────
function syncCanvasSize() {
  const overlay = document.querySelector<HTMLElement>('.encuadre-overlay')!;
  if (video.videoWidth && video.videoHeight) {
    renderer.resize(video.videoWidth, video.videoHeight);
    const width = video.clientWidth;
    const height = video.clientHeight;
    if (width && height) {
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      overlay.style.width = `${(video.videoWidth * scale * 100) / width}%`;
      overlay.style.height = `${(video.videoHeight * scale * 100) / height}%`;
    }
  } else {
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    overlay.style.width = '100%';
    overlay.style.height = '100%';
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
  let indicacion = avisoEncuadreInicial;

  // 1. Obtención de landmarks del usuario (cámara o simulación)
  if (isSimulating) {
    userLandmarks = renderer.generateSyntheticPose(timestamp);
    encuadreBox?.classList.add('valido');
  } else if (cameraService.isRunning()) {
    if (visionService?.getReadyStatus() && !visionFaulted) {
      if (video.currentTime !== lastVideoTime) {
        try {
          const manos = reconocimientoLibre.checked
            ? 'cualquiera'
            : catalogoService.manoParaEncuadre(manoPreferida.value);
          lastDetection = visionService.detect(
            video,
            timestamp,
            annotation.isRecording() ? 'ambas' : manos
          );
          freshFrame = true;
          lastVideoTime = video.currentTime;
          lastDetectionAt = timestamp;
        } catch (error) {
          visionFaulted = true;
          practicaLsec.cancelar();
          lastDetection = { landmarks: {}, encuadreValido: false };
          visionService.resetTracking();
          annotation.finish();
          resourceStatus(
            'vision',
            mensajes.visionError(
              error instanceof Error ? error.message : mensajes.recursoNoDisponible
            ),
            'error'
          );
        }
      }
      if (timestamp - lastDetectionAt > 250) {
        lastDetection = { landmarks: {}, encuadreValido: false };
        visionService.resetTracking();
      }
      const detection = lastDetection;
      userLandmarks = detection.landmarks;
      indicacion = detection.indicacion ?? avisoEncuadreInicial;

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

  if (avisoEncuadre.textContent !== indicacion) avisoEncuadre.textContent = indicacion;
  if (freshFrame) frameCount++;
  if (!isSimulating) practicaLsec.registrar(userLandmarks, timestamp, freshFrame);

  // 2. Renderizado del espejo del usuario
  if (userLandmarks.pose || userLandmarks.rightHand || userLandmarks.leftHand) {
    renderer.render(userLandmarks, practicaLsec.colores);

    if (freshFrame) annotation.record(userLandmarks);
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
  practicaLsec.cancelar();
  if (activeUnit === null) return;
  if (cameraService.isRunning()) {
    annotation.finish();
    cameraRequest++;
    cameraService.stop();
    lastVideoTime = -1;
    lastDetection = { landmarks: {}, encuadreValido: false };
    renderer.clear();
    encuadreBox?.classList.remove('valido');
    btnToggleCamera.textContent = mensajes.encenderCamara;
    resourceStatus('camera', mensajes.camaraDetenida, 'ready');
    statusDisplay.textContent = mensajes.camaraDetenida;
    statusDisplay.className = 'status-indicator camera-status';
  } else {
    await Promise.all([prepareVision(sessionId), startCamera(sessionId)]);
  }
});

// ─── Control de simulación sintética (Spike/Offline) ─────────────────────────
btnToggleSynthetic.addEventListener('click', () => {
  practicaLsec.cancelar();
  annotation.finish();
  cameraRequest++;
  cameraService.stop();
  btnToggleCamera.disabled = false;
  btnToggleCamera.textContent = mensajes.encenderCamara;
  resourceStatus('camera', mensajes.camaraDetenida, 'ready');
  isSimulating = !isSimulating;
  if (isSimulating) {
    btnToggleSynthetic.textContent = mensajes.detenerSimulacion;
    statusDisplay.textContent = mensajes.simulacionActiva;
    statusDisplay.className = 'status-indicator camera-status ready';
  } else {
    btnToggleSynthetic.textContent = mensajes.activarSimulacion;
    statusDisplay.textContent = mensajes.espera;
    statusDisplay.className = 'status-indicator camera-status';
    renderer.clear();
  }
});

// ─── Registro de Service Worker para PWA (offline) ───────────────────────────
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('[PWA] Service Worker no registrado (modo dev local):', err);
    });
  });
}
