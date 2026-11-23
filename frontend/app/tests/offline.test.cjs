const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker(
  responder = async () => {
    throw Error('Offline');
  }
) {
  const handlers = {};
  const snapshots = new Map([
    ['visenia-obsolete', new Map()],
    ['visenia-previous', new Map([['/assets/old.js', { body: 'previous chunk' }]])],
    ['other-app', new Map()],
  ]);
  const deleted = [];
  const requests = [];
  const lifecycleActions = [];
  const self = {
    location: { origin: 'https://visenia.local' },
    __VISENIA_CACHE: 'visenia-current',
    __VISENIA_PRECACHE: ['/index.html', '/wasm/vision_wasm_internal.wasm', '/models/avatar.vrm'],
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
    skipWaiting: async () => {
      lifecycleActions.push('skipWaiting');
    },
    clients: {
      claim: async () => {
        lifecycleActions.push('claim');
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), {
    self,
    URL,
    Response,
    caches: {
      open: async (name) => {
        if (!snapshots.has(name)) snapshots.set(name, new Map());
        const entries = snapshots.get(name);
        return {
          async addAll(paths) {
            paths.forEach((url) => entries.set(url, { body: url, status: 200 }));
          },
          async match(url) {
            return entries.get(url);
          },
        };
      },
      keys: async () => [...snapshots.keys()],
      delete: async (key) => {
        deleted.push(key);
        snapshots.delete(key);
      },
    },
    fetch: async (request, options) => {
      requests.push([request.url, options?.cache]);
      return responder(request);
    },
  });
  return {
    self,
    deleted,
    requests,
    lifecycleActions,
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
  for (const path of ['/docs', '/redoc', '/openapi.json', '/api/health'])
    assert.equal(sw.request('https://visenia.local' + path, 'navigate'), undefined);
  sw.self.__VISENIA_PRECACHE = undefined;
  assert.equal(sw.request('https://visenia.local/index.html'), undefined);
});

test('en línea, navegar usa el HTML vigente sin sustituir la copia offline', async () => {
  let status = 200;
  const sw = worker(async () => ({ body: 'network', status }));
  await sw.lifecycle('install');
  const url = 'https://visenia.local/';
  assert.equal((await sw.request(url, 'navigate')).body, 'network');
  assert.deepEqual(sw.requests, [[url, 'no-cache']]);
  status = 503;
  assert.equal((await sw.request(url, 'navigate')).body, '/index.html');
  status = 404;
  assert.equal((await sw.request(url, 'navigate')).status, 404);
});

test('una actualización toma el control y conserva recursos con hash del build anterior', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.deepEqual(sw.lifecycleActions, ['skipWaiting', 'claim']);
  assert.deepEqual(sw.deleted, ['visenia-obsolete']);
  assert.equal((await sw.request('https://visenia.local/assets/old.js')).body, 'previous chunk');
});
