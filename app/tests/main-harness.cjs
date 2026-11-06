const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-ts.cjs');
const { CatalogoPlayerService } = load('src/catalogo/catalogo-service.ts');
const refs = require('../public/data/referencias-v1.json');

exports.deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
exports.flush = () => new Promise((resolve) => setImmediate(resolve));
exports.boot = (options = {}) => {
  const elements = new Map(),
    counts = { avatar: 0, vision: 0, camera: 0, stops: 0, renders: 0 };
  const poses = [],
    raf = new Map();
  let frameId = 0,
    running = false,
    ready = false,
    vrm = false;
  function element(id = '') {
    if (!id) return makeElement('');
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  }
  function makeElement(id) {
    const classes = new Set();
    return {
      id,
      value: '1',
      textContent: '',
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      children: [],
      listeners: {},
      attributes: {},
      classList: {
        add: (...xs) => xs.forEach((x) => classes.add(x)),
        remove: (...xs) => xs.forEach((x) => classes.delete(x)),
        contains: (x) => classes.has(x),
        toggle: (x, force) => {
          const yes = force ?? !classes.has(x);
          yes ? classes.add(x) : classes.delete(x);
          return yes;
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      replaceChildren(...children) {
        this.children = children;
      },
      set innerHTML(value) {
        this.children = [];
      },
      get innerHTML() {
        return '';
      },
      getBoundingClientRect: () => ({ width: 640, height: 480 }),
      querySelector: (selector) => element(selector),
      focus() {
        this.focused = true;
      },
      click() {
        return this.listeners.click?.();
      },
    };
  }
  class Viewer {
    async loadModel() {
      counts.avatar++;
      await options.avatar?.();
      vrm = true;
    }
    getVrm() {
      return vrm ? {} : null;
    }
    start() {
      counts.renders++;
    }
    stop() {
      counts.renders = 0;
    }
    updatePose(pose) {
      poses.push(pose);
    }
    resetPose() {
      poses.push(null);
    }
  }
  class Camera {
    async start() {
      counts.camera++;
      await options.camera?.();
      running = true;
    }
    stop() {
      counts.stops++;
      running = false;
    }
    isRunning() {
      return running;
    }
  }
  class Vision {
    async init() {
      counts.vision++;
      await options.vision?.();
      ready = true;
    }
    getReadyStatus() {
      return ready;
    }
    detect() {
      return { landmarks: {}, encuadreValido: false };
    }
  }
  class Catalog extends CatalogoPlayerService {
    async loadCatalog() {
      await options.catalog?.();
      if (options.catalogError) {
        this.isLoaded = false;
        return [];
      }
      this.catalogo = options.refs ?? refs;
      this.isLoaded = true;
      return this.catalogo;
    }
  }
  class Renderer {
    resize() {}
    clear() {}
    render() {}
  }
  class Annotation {
    getIsRecording() {
      return false;
    }
  }
  const modules = {
    '../i18n/es-EC/mensajes': require('./load-ts.cjs')('i18n/es-EC/mensajes.ts'),
    './camera/camera-service': { CameraService: Camera },
    './vision/vision-service': { VisionService: Vision },
    './avatar/vrm-loader-spike': { VrmAvatarViewer: Viewer },
    './catalogo/catalogo-service': { CatalogoPlayerService: Catalog },
    './render/skeleton-renderer': { SkeletonRenderer: Renderer },
    './anotador/annotation-service': { AnnotationService: Annotation },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function(
    'require',
    'exports',
    'document',
    'window',
    'navigator',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    code
  )(
    (name) => modules[name],
    {},
    { getElementById: element, querySelector: element, createElement: () => element() },
    { addEventListener() {}, location: { protocol: 'http:' } },
    {},
    (fn) => {
      raf.set(++frameId, fn);
      return frameId;
    },
    (id) => raf.delete(id)
  );
  return {
    element,
    counts,
    poses,
    raf,
    card: (unit) => element('tematicas-grid').children.find((x) => x.dataset.unit === String(unit)),
    running: () => running,
  };
};
