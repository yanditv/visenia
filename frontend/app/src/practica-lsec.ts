import { clienteLsec, frameLsec } from '../../../frontend-contract/example-lsec-client';
import { evaluarLocal } from '../../../frontend-contract/motor-lsec';
import type {
  FrameCaptura,
  IdReferencia,
  PlantillaLsec,
  Zona,
} from '../../../frontend-contract/visena-lsec.types';
import type { HolisticFrameLandmarks } from './render/skeleton-renderer';

export class PracticaLsec {
  readonly colores = new Map<Zona, string>();
  private readonly api = clienteLsec();
  private toma?: {
    frames: FrameCaptura[];
    inicio: number;
    ancho: number;
    alto: number;
    objetivo?: IdReferencia;
    mano_practica?: 'izquierda' | 'derecha';
    plantilla?: Promise<PlantillaLsec | undefined>;
  };
  private pendiente?: AbortController;

  constructor(
    private boton: HTMLButtonElement,
    private salida: HTMLElement
  ) {}

  private async cargarPlantilla(id: IdReferencia) {
    const url = '/api/v1/lsec/plantillas/' + encodeURIComponent(id);
    const cache =
      typeof caches === 'undefined'
        ? undefined
        : await caches.open('lsec-motor-publicado-v1').catch(() => undefined);
    try {
      const plantilla = await this.api.plantilla(id, AbortSignal.timeout(4000));
      if (plantilla.estado !== 'publicada') {
        await cache?.delete(url);
        return;
      }
      await cache?.put(url, Response.json(plantilla)).catch(() => undefined);
      return plantilla;
    } catch (error) {
      if (error instanceof Error && 'status' in error) {
        if (error.status === 404) await cache?.delete(url);
        return;
      }
      return (await cache?.match(url))?.json() as Promise<PlantillaLsec> | undefined;
    }
  }

  cancelar() {
    this.colores.clear();
    this.toma = undefined;
    this.pendiente?.abort();
    this.pendiente = undefined;
    this.boton.disabled = false;
    this.boton.textContent = 'Probar seña';
    this.salida.textContent = '';
  }

  activar(
    camaraLista: boolean,
    ancho: number,
    alto: number,
    objetivo?: IdReferencia,
    mano_practica?: 'izquierda' | 'derecha'
  ) {
    if (this.toma) return this.terminar();
    if (this.pendiente) return;
    this.colores.clear();
    if (!camaraLista || !ancho || !alto) {
      this.salida.textContent = 'Activa la cámara y espera a que el espejo muestre tu movimiento.';
      return;
    }
    this.toma = {
      frames: [],
      inicio: performance.now(),
      ancho,
      alto,
      objetivo,
      mano_practica,
      plantilla: objetivo ? this.cargarPlantilla(objetivo).catch(() => undefined) : undefined,
    };
    this.boton.textContent = 'Terminar toma';
    this.salida.textContent =
      'Haz una seña y pulsa Terminar toma. La captura dura hasta seis segundos.';
  }

  registrar(landmarks: HolisticFrameLandmarks, ahora: number, fresco: boolean) {
    const toma = this.toma;
    if (!toma) return;
    const ms = Math.round(ahora - toma.inicio);
    if (ms >= 6000) {
      void this.terminar();
      return;
    }
    if (
      fresco &&
      ms >= 0 &&
      (!toma.frames.length || ms - toma.frames[toma.frames.length - 1].timestamp_ms >= 40)
    ) {
      toma.frames.push(frameLsec(landmarks, toma.frames.length, ms));
    }
  }

  private async terminar() {
    const toma = this.toma;
    this.cancelar();
    if (!toma || toma.frames.length < 4) {
      this.salida.textContent = 'Se necesitan más cuadros de cámara. Repite la toma.';
      return;
    }
    const control = new AbortController();
    this.pendiente = control;
    this.boton.disabled = true;
    this.salida.textContent = 'Comparando la seña…';
    try {
      const { ancho, alto, frames, objetivo } = toma;
      const captura = {
        schema_version: '1.1.0' as const,
        ancho,
        alto,
        frames,
        mano_practica: toma.mano_practica,
      };
      const signal = AbortSignal.any([control.signal, AbortSignal.timeout(15000)]);
      const intervaloMedio =
        (frames[frames.length - 1].timestamp_ms - frames[0].timestamp_ms) / (frames.length - 1);
      let texto =
        intervaloMedio > 350
          ? 'La cámara entregó muy pocos cuadros por segundo. Repite la toma con seguimiento fluido.'
          : 'Repite la toma con la mano y los hombros visibles.';
      if (objetivo) {
        const plantilla = await toma.plantilla;
        if (!plantilla) throw new Error('Plantilla no disponible.');
        if (control.signal.aborted) return;
        const r = evaluarLocal(plantilla, captura);
        if (r.ejecucion) {
          const resultado = r.ejecucion.resultado;
          for (const parametro of Object.values(resultado.parametros_evaluados)) {
            for (const zona of parametro.zonas_resaltar) {
              if (parametro.estado === 'rojo') this.colores.set(zona, '#ef4444');
              else if (parametro.estado === 'amarillo' && !this.colores.has(zona))
                this.colores.set(zona, '#f59e0b');
            }
          }
          const consejos = Object.values(resultado.parametros_evaluados)
            .filter((p) => p.estado !== 'verde')
            .map((p) => p.mensaje_feedback);
          texto = [`Puntaje: ${resultado.puntaje_global}/100.`, ...consejos].join(' ');
        } else if (r.estado === 'sin_calibracion')
          texto = 'Toma comparada. La puntuación de esta seña está pendiente de calibración.';
      } else {
        const r = await this.api.reconocer(captura, signal, true);
        if (r.candidatas.length) texto = `Sugerencia experimental: ${r.candidatas[0].glosa}.`;
        if (r.estado === 'sin_referencias')
          texto = 'El laboratorio aún no tiene plantillas de reconocimiento.';
      }
      if (!control.signal.aborted) this.salida.textContent = texto;
    } catch {
      if (!control.signal.aborted)
        this.salida.textContent =
          'No se pudo comparar la toma. Comprueba la conexión con el laboratorio y vuelve a intentar.';
    } finally {
      if (this.pendiente === control) {
        this.pendiente = undefined;
        this.boton.disabled = false;
      }
    }
  }
}
