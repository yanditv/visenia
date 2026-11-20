const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker() {
  const handlers = {};
  const entries = new Map();
  const deleted = [];
  const cache = {
    async addAll(paths) {
      paths.forEach((url) => entries.set(url, { body: url }));
    },
    async match(url) {
      return entries.get(url);
    },
  };
  const self = {
    location: { origin: 'https://visenia.local' },
    __VISENIA_CACHE: 'visenia-current',
    __VISENIA_PRECACHE: ['/index.html', '/wasm/vision_wasm_internal.wasm', '/models/avatar.vrm'],
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), {
    self,
    URL,
    caches: {
      open: async () => cache,
      keys: async () => ['visenia-old', 'visenia-current', 'other-app'],
      delete: async (key) => {
        deleted.push(key);
      },
    },
    fetch: () => {
      throw Error('Offline');
    },
  });
  return {
    self,
    deleted,
    async lifecycle(type) {
      let done;
      handlers[type]({
        waitUntil: (promise) => {
          done = promise;
        },
      });
      await done;
    },
    request(url, mode = 'cors', method = 'GET') {
      let response;
      handlers.fetch({
        request: { url, mode, method },
        respondWith: (promise) => {
          response = promise;
        },
      });
      return response;
    },
  };
}

test('el worker conserva navegación, modelos y WASM para una sesión sin red', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(
    (await sw.request('https://visenia.local/tematica/1', 'navigate')).body,
    '/index.html'
  );
  assert.equal(
    (await sw.request('https://visenia.local/wasm/vision_wasm_internal.wasm')).body,
    '/wasm/vision_wasm_internal.wasm'
  );
  assert.equal(
    (await sw.request('https://visenia.local/models/avatar.vrm')).body,
    '/models/avatar.vrm'
  );
});

test('el worker no intercepta API, otros orígenes, escrituras ni recursos ajenos al build', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  for (const [url, method] of [
    ['https://visenia.local/api/health', 'GET'],
    ['https://otro.local/index.html', 'GET'],
    ['https://visenia.local/index.html', 'POST'],
    ['https://visenia.local/dato-privado.json', 'GET'],
  ])
    assert.equal(sw.request(url, 'cors', method), undefined);
  sw.self.__VISENIA_PRECACHE = undefined;
  assert.equal(sw.request('https://visenia.local/index.html'), undefined);
});

test('activar el worker elimina únicamente versiones anteriores de Viseña', async () => {
  const sw = worker();
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['visenia-old']);
});
