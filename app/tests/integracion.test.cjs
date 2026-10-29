const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-ts.cjs');
const { CatalogoPlayerService } = load('src/catalogo/catalogo-service.ts');
const refs = require('../public/data/referencias-v1.json');
test('las tres referencias actuales tienen mano anatómica de respaldo y coordenadas coherentes', () => {
  for (const ref of refs) {
    const c = new CatalogoPlayerService();
    c.catalogo = [ref];
    c.selectSena(ref.id);
    const l = c.update(performance.now()).landmarks;
    assert.equal(l.isDemo, true);
    assert.equal(l.poseWorld, undefined);
    assert.ok(l.pose[11].x > l.pose[12].x);
    assert.ok(l.rightHand[12].y < l.rightHand[9].y);
    assert.equal(l.rightHand.length, 21);
  }
});
test('scrubbing del catálogo no sobrescribe el modo espejo', async () => {
  const elements = new Map(),
    callbacks = [];
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: '1',
        textContent: '',
        style: {},
        setAttribute() {},
        classList: { add() {}, remove() {} },
        listeners: {},
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        getBoundingClientRect() {
          return { width: 640, height: 480 };
        },
        querySelector() {
          return element('loadingText');
        },
        appendChild() {},
      });
    return elements.get(id);
  };
  const calls = [];
  let resetCount = 0;
  class Viewer {
    loadModel() {
      return Promise.resolve();
    }
    start() {}
    updatePose(x) {
      calls.push(x);
    }
    resetPose() {
      resetCount++;
    }
  }
  class Catalog {
    loadCatalog() {
      return Promise.resolve([]);
    }
    getSelectedSena() {
      return { ...refs[0], frames: [{}, {}] };
    }
    update() {
      return { landmarks: { pose: [{ x: 1, y: 1 }] }, frameIndex: 1, totalFrames: 2 };
    }
    seekFrame() {}
    pause() {}
    getIsPlaying() {
      return false;
    }
    getSpeed() {
      return 1;
    }
  }
  class Camera {
    isRunning() {
      return false;
    }
  }
  class Renderer {
    resize() {}
    clear() {}
    render() {}
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules = {
    './camera/camera-service': { CameraService: Camera },
    './render/skeleton-renderer': { SkeletonRenderer: Renderer },
    './vision/vision-service': { VisionService: class {} },
    './avatar/vrm-loader-spike': { VrmAvatarViewer: Viewer },
    './anotador/annotation-service': { AnnotationService: class {} },
    './catalogo/catalogo-service': { CatalogoPlayerService: Catalog },
  };
  new Function(
    'require',
    'exports',
    'document',
    'window',
    'navigator',
    'requestAnimationFrame',
    code
  )(
    (n) => modules[n],
    {},
    { getElementById: element, querySelector: element, createElement: () => element('option') },
    { addEventListener() {}, location: { protocol: 'http:' } },
    {},
    (fn) => callbacks.push(fn)
  );
  await Promise.resolve();
  element('btn-mode-espejo').listeners.click();
  const before = calls.length;
  element('slider-player-progress').listeners.input();
  assert.equal(calls.length, before);
  assert.ok(resetCount > 0);
});
