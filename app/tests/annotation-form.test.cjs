const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./main-harness.cjs');

function annotatedForm() {
  const app = boot({ recordedFrames: [{ timestamp_ms: 0 }] });
  const fields = {
    'input-glosa': 'SALUDO',
    'select-unidad': '2',
    'select-dificultad': 'facil',
    'select-mano-dom': 'derecha',
    'select-toponema': 'pecho',
    'select-kinesema': 'curvo',
    'input-queirema': 'mano_abierta',
    'input-queirema-desc': 'Dedos separados',
    'input-palma-x': '-0.5',
    'input-palma-y': '0',
    'input-palma-z': '1',
    'input-repeticiones': '3',
    'slider-frame-inicio': '0',
    'slider-frame-fin': '4',
    'select-prosoponema-target': '',
    'input-prosoponema-coef': '',
  };
  for (const [id, value] of Object.entries(fields)) app.element(id).value = value;
  app.element('check-prosoponema').checked = false;
  return app;
}

test('export uses the entered phonological annotations', () => {
  const app = annotatedForm();
  app.element('btn-export-json').click();
  assert.equal(app.downloads.length, 1);
  const config = app.annotationConfigs[0];
  assert.deepEqual(config.kinemaPalma, [-0.5, 0, 1]);
  assert.equal(config.kinesemaRepeticiones, 3);
  assert.equal(config.queiremaDesc, 'Dedos separados');
  assert.equal(config.queiremaForma, 'mano_abierta');
});

test('export blocks blank, invalid, or zero-vector annotations before download', () => {
  for (const [id, value] of [
    ['input-palma-x', ''],
    ['input-palma-y', ' '],
    ['input-palma-z', 'no-numero'],
    ['input-repeticiones', ''],
    ['input-repeticiones', '1.5'],
    ['input-repeticiones', '-1'],
    ['input-queirema-desc', ' '],
    ['input-queirema', ''],
    ['select-unidad', ''],
  ]) {
    const app = annotatedForm();
    app.element(id).value = value;
    app.element('btn-export-json').click();
    assert.equal(app.downloads.length, 0, `${id}=${JSON.stringify(value)}`);
    assert.equal(app.annotationConfigs.length, 0);
  }
  const app = annotatedForm();
  for (const axis of ['x', 'y', 'z']) app.element(`input-palma-${axis}`).value = '0';
  app.element('btn-export-json').click();
  assert.equal(app.downloads.length, 0);
});

test('required facial expression blocks missing targets and exports an explicit coefficient', () => {
  const app = annotatedForm();
  app.element('check-prosoponema').checked = true;
  app.element('check-prosoponema').listeners.change();
  assert.equal(app.element('input-prosoponema-coef').required, true);
  assert.equal(app.element('input-prosoponema-coef').disabled, false);
  app.element('btn-export-json').click();
  assert.equal(app.downloads.length, 0);
  app.element('select-prosoponema-target').value = 'browInnerUp';
  for (const invalid of ['', '1.1', '-0.1']) {
    app.element('input-prosoponema-coef').value = invalid;
    app.element('btn-export-json').click();
    assert.equal(app.downloads.length, 0);
  }
  app.element('input-prosoponema-coef').value = '0.65';
  app.element('btn-export-json').click();
  assert.equal(app.downloads.length, 1);
  assert.deepEqual(app.annotationConfigs[0].prosoponemaBlendshapes, { browInnerUp: 0.65 });
  app.element('input-prosoponema-coef').value = '0';
  app.element('input-repeticiones').value = '0';
  app.element('btn-export-json').click();
  assert.equal(app.downloads.length, 2);
  assert.deepEqual(app.annotationConfigs[1].prosoponemaBlendshapes, { browInnerUp: 0 });
  assert.equal(app.annotationConfigs[1].kinesemaRepeticiones, 0);
  app.element('check-prosoponema').checked = false;
  app.element('check-prosoponema').listeners.change();
  assert.equal(app.element('input-prosoponema-coef').required, false);
  assert.equal(app.element('input-prosoponema-coef').disabled, true);
});
