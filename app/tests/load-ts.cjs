const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();

module.exports = function loadTs(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (name.includes('GLTFLoader') || name === '@mediapipe/tasks-vision') return {};
    if (name.startsWith('.'))
      return module.exports(
        path.relative(
          path.resolve(__dirname, '..'),
          path.resolve(path.dirname(filename), name + '.ts')
        )
      );
    return require(name);
  }, exports);
  return exports;
};
