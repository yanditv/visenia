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
  const { boot, flush } = require('./main-harness.cjs');
  const app = boot();
  await flush();
  await app.card(1).click();
  app.element('btn-mode-espejo').click();
  const before = app.poses.length;
  app.element('slider-player-progress').listeners.input();
  assert.equal(app.poses.length, before);
  assert.equal(app.element('btn-player-play').disabled, true);
});
