const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadVision(tasks) {
  const filename = path.resolve(__dirname, '../src/vision/vision-service.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'console', code)(
    (name) => {
      assert.equal(name, '@mediapipe/tasks-vision');
      return tasks;
    },
    exports,
    { log() {}, error() {} }
  );
  return new exports.VisionService();
}

for (const failedModel of ['PoseLandmarker', 'HandLandmarker', 'FaceLandmarker']) {
  test(`retry preserves loaded models after ${failedModel} fails`, async () => {
    const allocated = {};
    const calls = {};
    const tasks = { FilesetResolver: { forVisionTasks: async () => ({}) } };
    for (const name of ['PoseLandmarker', 'HandLandmarker', 'FaceLandmarker']) {
      allocated[name] = [];
      calls[name] = 0;
      tasks[name] = {
        async createFromOptions() {
          calls[name]++;
          if (name === failedModel && calls[name] === 1) throw new Error('model unavailable');
          const model = {
            close() {
              this.closed = true;
            },
          };
          allocated[name].push(model);
          return model;
        },
      };
    }
    const service = loadVision(tasks);
    await assert.rejects(service.init());
    assert.equal(service.getReadyStatus(), false);
    await service.init();
    assert.equal(service.getReadyStatus(), true);
    await service.init();
    for (const name of Object.keys(calls)) {
      assert.equal(calls[name], name === failedModel ? 2 : 1, `${name} reallocated`);
      assert.equal(allocated[name].length, 1);
      assert.equal(allocated[name][0].closed, undefined);
    }
  });
}

test('concurrent init callers await the same initialization and local WASM fileset', async () => {
  let resolveFileset;
  let filesetCalls = 0;
  let filesetUrl;
  const fileset = new Promise((resolve) => {
    resolveFileset = resolve;
  });
  const tasks = {
    FilesetResolver: {
      forVisionTasks(url) {
        filesetCalls++;
        filesetUrl = url;
        return fileset;
      },
    },
  };
  for (const name of ['PoseLandmarker', 'HandLandmarker', 'FaceLandmarker']) {
    tasks[name] = { createFromOptions: async () => ({}) };
  }
  const service = loadVision(tasks);
  const first = service.init();
  let secondSettled = false;
  const second = service.init().finally(() => {
    secondSettled = true;
  });
  await Promise.resolve();
  const settledBeforeFileset = secondSettled;
  assert.equal(service.getReadyStatus(), false);
  resolveFileset({});
  await Promise.all([first, second]);
  assert.equal(settledBeforeFileset, false);
  assert.equal(filesetUrl, '/wasm');
  assert.equal(filesetCalls, 1);
  assert.equal(service.getReadyStatus(), true);
});
