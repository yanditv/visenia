/* El build inyecta el inventario y su versión antes de este archivo. */
self.addEventListener('install', (event) => {
  if (!self.__VISENIA_PRECACHE) return;
  event.waitUntil(
    caches.open(self.__VISENIA_CACHE).then((cache) => cache.addAll(self.__VISENIA_PRECACHE))
  );
});

self.addEventListener('activate', (event) => {
  if (!self.__VISENIA_CACHE) return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('visenia-') && key !== self.__VISENIA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    !self.__VISENIA_PRECACHE
  )
    return;
  // Solo conserva el inventario del build: nunca respuestas de API o datos de cámara.
  const path = event.request.mode === 'navigate' ? '/index.html' : url.pathname;
  if (!self.__VISENIA_PRECACHE.includes(path)) return;
  event.respondWith(
    caches
      .open(self.__VISENIA_CACHE)
      .then((cache) => cache.match(path))
      .then((cached) => cached || fetch(event.request))
  );
});
