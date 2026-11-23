const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PracticaLsec } = require('./load-ts.cjs')('src/practica/practica-lsec.ts');

function capturar(practica) {
  practica.activar(true, 640, 480, 'ref-azul', 'derecha');
  for (let i = 0; i < 5; i++) {
    practica.registrar({}, i * 50, true);
    practica.registrar({}, i * 50, false);
  }
}
const resultado = {
  resultado: {
    estado: 'sin_calibracion',
    similitud: {
      glosa: 'AZUL',
      puntaje: 64.5,
      por_parametro: { kinesema_movimiento: 29 },
      mensaje_feedback: 'Compara el recorrido de la mano.',
      zonas_resaltar: ['mano_derecha'],
    },
  },
};

test('envía cuadros frescos y descarta una respuesta al salir', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const boton = {},
    salida = {},
    practica = new PracticaLsec(boton, salida);
  let recibido, resolver;
  practica.api = {
    practicar: (captura, signal) => {
      recibido = { captura, signal };
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
  };
  practica.activar(false, 640, 480);
  assert.match(salida.textContent, /Activa la cámara/);
  capturar(practica);
  const envio = practica.activar(true, 640, 480);
  assert.equal(recibido.captura.frames.length, 5);
  assert.equal(recibido.captura.segmentar, true);
  practica.cancelar();
  assert.equal(recibido.signal.aborted, true);
  resolver(resultado);
  await envio;
  assert.equal(salida.textContent, '');
  assert.equal(practica.colores.size, 0);
});

test('muestra la nota persistida y reintenta con el mismo identificador', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const boton = {},
    salida = {},
    practica = new PracticaLsec(boton, salida);
  const ids = [];
  practica.api = {
    practicar: async (toma) => {
      ids.push(toma.id_intento);
      assert.equal(toma.id_referencia, 'ref-azul');
      if (ids.length === 1) throw new Error('Respuesta perdida después del guardado');
      return resultado;
    },
  };
  capturar(practica);
  await practica.activar(true, 640, 480);
  assert.equal(boton.textContent, 'Reintentar');
  await practica.activar(true, 640, 480);
  assert.equal(ids[0], ids[1]);
  assert.match(salida.textContent, /AZUL: 64.5\/100.*recorrido/);
  assert.match(salida.textContent, /guardado/);
  assert.ok(practica.colores.has('mano_derecha'));
});
