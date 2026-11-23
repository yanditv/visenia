/* El build inyecta el inventario y su versión antes de este archivo. */
self.addEventListener('install', (event) => {
  if (!self.__VISENIA_PRECACHE) return;
  event.waitUntil(
    caches
      .open(self.__VISENIA_CACHE)
      .then((cache) => cache.addAll(self.__VISENIA_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  if (!self.__VISENIA_CACHE) return;
  event.waitUntil(
    (async () => {
      const anteriores = await versionesAnteriores();
      // Una pestaña abierta puede cargar un módulo de la versión previa al iniciar una práctica.
      await Promise.all(anteriores.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

async function versionesAnteriores() {
  return (await caches.keys()).filter(
    (key) => key.startsWith('visenia-') && key !== self.__VISENIA_CACHE
  );
}

async function navegar(request) {
  const respuesta = await fetch(request, { cache: 'no-cache' }).catch(() => null);
  if (respuesta && respuesta.status < 500) return respuesta;
  // Conserva el HTML y los recursos de la misma compilación para el arranque sin conexión.
  const cache = await caches.open(self.__VISENIA_CACHE);
  return (await cache.match('/index.html')) ?? respuesta ?? Response.error();
}

async function cargarRecursoAnterior(request, path) {
  const anterior = (await versionesAnteriores()).at(-1);
  if (anterior) {
    const guardado = await (await caches.open(anterior)).match(path);
    if (guardado) return guardado;
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    /^\/(?:api|docs|redoc)(?:\/|$)/.test(url.pathname) ||
    !self.__VISENIA_PRECACHE
  )
    return;
  const path = url.pathname;
  const app =
    path === '/index.html' ||
    (!/\.[^/]*$/.test(path) && !/^\/(?:assets|models|wasm|mediapipe)(?:\/|$)/.test(path));
  if (event.request.mode === 'navigate' && app) {
    event.respondWith(navegar(event.request));
    return;
  }
  if (!self.__VISENIA_PRECACHE.includes(path)) {
    if (path.startsWith('/assets/')) event.respondWith(cargarRecursoAnterior(event.request, path));
    return;
  }
  event.respondWith(
    caches
      .open(self.__VISENIA_CACHE)
      .then((cache) => cache.match(path))
      .then((cached) => cached || fetch(event.request))
  );
});
