const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PracticaLsec } = require('./load-ts.cjs')('src/practica-lsec.ts');

test('la práctica envía solo cuadros frescos y descarta una respuesta al salir', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const boton = {},
    salida = {};
  const practica = new PracticaLsec(boton, salida);
  let recibido, resolver;
  practica.api = {
    reconocer: (captura, signal, segmentar) => {
      recibido = { captura, signal, segmentar };
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
  };
  practica.activar(false, 640, 480);
  assert.match(salida.textContent, /Activa la cámara/);
  practica.activar(true, 640, 480);
  for (let i = 0; i < 5; i++) {
    practica.registrar({}, i * 50, true);
    practica.registrar({}, i * 50, false);
  }
  const envio = practica.activar(true, 640, 480);
  assert.equal(recibido.captura.frames.length, 5);
  assert.equal(recibido.segmentar, true);
  assert.equal(boton.disabled, true);
  practica.cancelar();
  assert.equal(recibido.signal.aborted, true);
  resolver({ estado: 'experimental', candidatas: [{ glosa: 'HOLA' }] });
  await envio;
  assert.equal(salida.textContent, '');
  assert.equal(boton.disabled, false);
});
