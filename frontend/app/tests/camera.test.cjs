const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('una cámara que termina de abrir después de stop libera las pistas y no enlaza el video', async () => {
  let resolve,
    stopped = 0;
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/camera/camera-service.ts'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }
  ).outputText;
  const output = {};
  new Function('exports', 'navigator', code)(output, {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
  });
  const { CameraService } = output;
  const video = { srcObject: null, play: async () => {} };
  const camera = new CameraService(video);
  const pending = camera.start().then(
    () => false,
    (error) => /cancelad/i.test(error.message)
  );
  camera.stop();
  resolve({ active: true, getTracks: () => [{ stop: () => stopped++ }] });
  const cancelled = await pending;
  assert.equal(cancelled, true);
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(camera.isRunning(), false);
});
