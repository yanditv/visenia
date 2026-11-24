const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const cliente = load('../../contracts/typescript/cliente-lsec.ts');
const { instalarTrayectoria } = load('src/progreso/trayectoria.ts');

test('los niveles usan XP guardados y los hitos cuentan señas distintas con nota', async (t) => {
  let xp = 0;
  const senas = [];
  t.mock.method(cliente, 'clienteLsec', () => ({
    trayectoria: async () => ({ xp, hoy: 0, meta_diaria: 3, racha: 0 }),
    progreso: async () => ({ senas }),
  }));
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) elementos.set(id, new EventTarget());
    return elementos.get(id);
  }
  const ventana = new EventTarget();
  const esperar = () => new Promise((resolve) => setImmediate(resolve));
  instalarTrayectoria({ getElementById: elemento }, ventana, () => {});
  await esperar();
  assert.match(elemento('nivel-valor').textContent, /1$/);
  assert.match(elemento('reto-nota').textContent, /primera nota/);
  async function guardar() {
    ventana.dispatchEvent(new Event('visenia:practice-saved'));
    await esperar();
  }
  xp = 90;
  senas.push(
    { id_referencia: 'ref-uno', mejor: 0 },
    { id_referencia: 'ref-uno', mejor: 80 },
    { id_referencia: 'ref-dos', mejor: null }
  );
  await guardar();
  assert.equal(elemento('nivel-progreso').value, 90);
  assert.equal(elemento('reto-valor').textContent, '1 seña con nota');
  assert.match(elemento('reto-nota').textContent, /5 señas/);
  xp = 100;
  await guardar();
  assert.match(elemento('nivel-valor').textContent, /2$/);
  assert.equal(elemento('nivel-progreso').value, 0);
  assert.match(elemento('nivel-nota').textContent, /100 XP/);
  for (let i = 1; i < 40; i++) senas.push({ id_referencia: 'ref-n' + i, mejor: 75 });
  xp = 500;
  await guardar();
  assert.match(elemento('reto-nota').textContent, /Completaste el reto de 40/);
});
