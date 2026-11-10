const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boot, flush, deferred } = require('./main-harness.cjs');

test('inicio muestra doce temáticas sin iniciar avatar, seguimiento ni cámara', async () => {
  const app = boot();
  await flush();
  assert.equal(app.element('tematicas-grid').children.length, 12);
  assert.equal(app.counts.avatar + app.counts.vision + app.counts.camera, 0);
  assert.equal(app.raf.size, 0);
});

test('entrar carga los tres recursos y filtra HOLA; Cortesía contiene GRACIAS y POR FAVOR', async () => {
  const app = boot();
  await flush();
  await app.card(1).click();
  assert.deepEqual([app.counts.avatar, app.counts.vision, app.counts.camera], [1, 1, 1]);
  assert.deepEqual(
    app.element('select-catalogo-sena').children.map((x) => x.value),
    ['ref-hola']
  );
  await app.element('btn-volver-tematicas').click();
  assert.equal(app.running(), false);
  assert.equal(app.counts.renders, 0);
  assert.equal(app.raf.size, 0);
  await app.card(12).click();
  assert.deepEqual(
    app.element('select-catalogo-sena').children.map((x) => x.value),
    ['ref-gracias', 'ref-por-favor']
  );
  assert.deepEqual([app.counts.avatar, app.counts.vision, app.counts.camera], [1, 1, 2]);
});

test('temática vacía muestra niveles inhabilitados sin abrir cámara ni avatar', async () => {
  const app = boot();
  await flush();
  await app.card(2).click();
  assert.equal(app.element('map-view').hidden, false);
  assert.equal(app.element('btn-start-level').disabled, true);
  assert.equal(
    app.element('level-path').children.every((item) => item.children[0].disabled),
    true
  );
  assert.equal(app.counts.camera + app.counts.avatar + app.counts.vision, 0);
});

test('cámara denegada conserva el avatar y el catálogo y permite reintentar', async () => {
  let attempts = 0;
  const app = boot({
    camera: async () => {
      if (++attempts === 1) throw Error('Permiso denegado');
    },
  });
  await flush();
  await app.card(1).click();
  assert.match(app.element('load-camera').textContent, /denegado/i);
  assert.equal(app.element('btn-player-play').disabled, false);
  await app.element('btn-toggle-camera').click();
  assert.equal(app.running(), true);
  assert.equal(app.counts.avatar, 1);
});

test('salir durante la carga y reingresar no reactiva recursos de la sesión anterior', async () => {
  const avatar = deferred(),
    vision = deferred(),
    camera = deferred();
  const app = boot({
    avatar: () => avatar.promise,
    vision: () => vision.promise,
    camera: () => camera.promise,
  });
  await flush();
  const first = app.card(1).click();
  await app.element('btn-volver-tematicas').click();
  const second = app.card(12).click();
  avatar.resolve();
  vision.resolve();
  camera.resolve();
  await Promise.all([first, second]);
  assert.equal(app.counts.avatar, 1);
  assert.equal(app.counts.vision, 1);
  assert.equal(app.element('practice-title').textContent, 'Cortesía');
  await app.element('btn-volver-tematicas').click();
  assert.equal(app.running(), false);
  assert.equal(app.counts.renders, 0);
  assert.equal(app.raf.size, 0);
});

test('fallo del avatar admite reintento sin reiniciar cámara ni MediaPipe', async () => {
  let attempts = 0;
  const app = boot({
    avatar: async () => {
      if (++attempts === 1) throw Error('Modelo no disponible');
    },
  });
  await flush();
  await app.card(1).click();
  assert.match(app.element('load-avatar').textContent, /no disponible/i);
  await app.element('btn-retry-resources').click();
  assert.deepEqual([app.counts.avatar, app.counts.vision, app.counts.camera], [2, 1, 1]);
});

test('fallo del catálogo se muestra sin bloquear el espejo', async () => {
  const app = boot({ catalogError: true });
  await flush();
  await app.element('tab-practica').click();
  await flush();
  assert.match(app.element('catalogo-notice').textContent, /no se pudo cargar/i);
  assert.equal(app.running(), true);
  assert.equal(app.element('btn-player-play').disabled, true);
});

test('reintentar un modelo mientras la cámara espera permiso no duplica su apertura', async () => {
  const camera = deferred();
  let attempts = 0;
  const app = boot({
    camera: () => camera.promise,
    avatar: async () => {
      if (++attempts === 1) throw Error('No disponible');
    },
  });
  await flush();
  const entry = app.card(1).click();
  await flush();
  const retry = app.element('btn-retry-resources').click();
  camera.resolve();
  await Promise.all([entry, retry]);
  assert.equal(app.counts.camera, 1);
  assert.equal(app.running(), true);
});

test('volver mientras reproduce y cambiar de temática deja el reproductor en pausa con etiqueta correcta', async () => {
  const app = boot();
  await flush();
  await app.card(12).click();
  app.element('btn-player-play').click();
  assert.match(app.element('btn-player-play').textContent, /Pausar/);
  app.element('btn-volver-tematicas').click();
  await app.card(1).click();
  assert.equal(app.element('btn-player-play').textContent, '▶ Reproducir');
  assert.equal(app.element('btn-player-play').classList.contains('playing'), false);
});

test('el catálogo tardío conserva el modo espejo elegido durante la descarga', async () => {
  const catalog = deferred();
  const app = boot({ catalog: () => catalog.promise });
  await flush();
  await app.element('tab-practica').click();
  await flush();
  app.element('btn-mode-espejo').click();
  assert.equal(app.element('btn-mode-espejo').attributes['aria-pressed'], 'true');
  catalog.resolve();
  await flush();
  assert.equal(app.element('btn-mode-espejo').attributes['aria-pressed'], 'true');
});
test('un fotograma detenido libera el espejo y el avatar y no repite inferencia', async () => {
  const landmarks = { pose: [{ x: 0.4, y: 0.5, z: 0 }] };
  const app = boot({ detect: () => ({ landmarks, encuadreValido: true }) });
  await flush();
  await app.card(1).click();
  app.element('btn-mode-espejo').click();
  app.element('webcam-video').currentTime = 1;
  app.frame(100);
  assert.equal(app.poses.at(-1), landmarks);
  app.frame(500);
  assert.deepEqual(app.poses.at(-1), {});
  assert.equal(app.counts.detections, 1);
});

test('un fallo de inferencia conserva el bucle y admite reintentar el seguimiento', async () => {
  let failing = true;
  const app = boot({
    detect: () => {
      if (failing) throw Error('Contexto GPU perdido');
      return { landmarks: {}, encuadreValido: false };
    },
  });
  await flush();
  await app.card(1).click();
  app.element('webcam-video').currentTime = 1;
  assert.doesNotThrow(() => app.frame(100));
  assert.equal(app.raf.size, 1);
  assert.match(app.element('load-vision').textContent, /GPU perdido/);
  app.element('webcam-video').currentTime = 2;
  app.frame(200);
  assert.equal(app.counts.detections, 1);
  failing = false;
  await app.element('btn-retry-resources').click();
  app.frame(300);
  assert.equal(app.counts.detections, 2);
  assert.equal(app.raf.size, 1);
});
test('el mapa solo inicia recursos al comenzar un nivel cargado y conserva su selección', async () => {
  const app = boot();
  await flush();
  app.theme(12).click();
  assert.equal(app.element('map-view').hidden, false);
  assert.deepEqual([app.counts.avatar, app.counts.vision, app.counts.camera], [0, 0, 0]);
  const nodes = app.element('level-path').children.map((item) => item.children[0]);
  assert.deepEqual(
    nodes.map((node) => node.disabled),
    [false, false, true, true, true, true]
  );
  nodes[1].click();
  assert.equal(app.element('level-title').textContent, 'POR FAVOR');
  await app.element('btn-start-level').click();
  assert.equal(app.element('select-catalogo-sena').value, 'ref-por-favor');
  app.element('btn-volver-tematicas').click();
  assert.equal(app.element('map-view').hidden, false);
  assert.equal(app.element('level-title').textContent, 'POR FAVOR');
  assert.equal(app.running(), false);
  assert.equal(app.raf.size, 0);
  app.element('btn-map-home').click();
  assert.equal(app.element('home-view').hidden, false);
});

test('el mapa actualiza los niveles cuando el catálogo llega tarde', async () => {
  const catalog = deferred();
  const app = boot({ catalog: () => catalog.promise });
  app.theme(1).click();
  assert.equal(app.element('btn-start-level').disabled, true);
  catalog.resolve();
  await flush();
  assert.equal(app.element('btn-start-level').disabled, false);
  assert.equal(app.element('level-title').textContent, 'HOLA');
  assert.deepEqual([app.counts.avatar, app.counts.vision, app.counts.camera], [0, 0, 0]);
});
