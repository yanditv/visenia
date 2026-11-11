const fs = require('node:fs');
const path = require('node:path');
const load = require('../tests/load-ts.cjs');
const { validateCatalog } = load('src/anotador/annotation-service.ts');

const file = path.resolve(__dirname, '..', 'public/data/referencias-v1.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
validateCatalog(catalog);
console.log(`Catálogo válido: ${catalog.length} referencias (${file}).`);
