const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const source = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const target = join(__dirname, '../public/wasm');
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
