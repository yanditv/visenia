import { clienteLsec, frameLsec } from '../../../../contracts/typescript/cliente-lsec';
import type {
  FrameCaptura,
  IdReferencia,
  IntentoPractica,
  Similitud,
  Zona,
} from '../../../../contracts/typescript/visena-lsec.types';
import type { VistaResultado } from './resultado';
import type { HolisticFrameLandmarks } from '../render/skeleton-renderer';

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
    id_intento: string;
  };
  private pendiente?: AbortController;
  private reintento?: IntentoPractica;

  constructor(
    private boton: HTMLButtonElement,
    private salida: HTMLElement,
    private vista?: VistaResultado
  ) {}

  private mostrarSimilitud(nota: Similitud) {
    for (const zona of nota.zonas_resaltar) this.colores.set(zona, '#f59e0b');
    if (this.vista) return `Similitud con ${nota.glosa}.`;
    return `Similitud con ${nota.glosa}: ${nota.puntaje}/100. ${nota.mensaje_feedback}`.trim();
  }

  cancelar() {
    this.colores.clear();
    this.reintento = undefined;
    this.toma = undefined;
    this.pendiente?.abort();
    this.pendiente = undefined;
    this.boton.disabled = false;
    this.boton.textContent = 'Probar seña';
    this.salida.textContent = '';
    this.vista?.limpiar();
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
    if (this.reintento) return this.comparar(this.reintento);
    this.colores.clear();
    if (!camaraLista || !ancho || !alto) {
      this.vista?.limpiar('error');
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
      id_intento: crypto.randomUUID(),
    };
    this.vista?.limpiar('recording');
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
      // El motor usa los coeficientes faciales, además de pose y manos.
      const frame = frameLsec({ ...landmarks, face: undefined }, toma.frames.length, ms);
      toma.frames.push(frame);
    }
  }

  private async terminar() {
    const toma = this.toma;
    this.cancelar();
    if (!toma || toma.frames.length < 4) {
      this.vista?.limpiar('error');
      this.salida.textContent = 'Se necesitan más cuadros de cámara. Repite la toma.';
      return;
    }
    return this.comparar({
      schema_version: '1.1.0',
      id_intento: toma.id_intento,
      ancho: toma.ancho,
      alto: toma.alto,
      frames: toma.frames,
      id_referencia: toma.objetivo,
      mano_practica: toma.mano_practica,
      segmentar: true,
    });
  }

  private async comparar(captura: IntentoPractica) {
    const control = new AbortController();
    this.pendiente = control;
    this.reintento = captura;
    this.boton.disabled = true;
    this.vista?.limpiar('loading');
    this.salida.textContent = 'Comparando y guardando la seña…';
    try {
      const signal = AbortSignal.any([control.signal, AbortSignal.timeout(20000)]);
      const guardada = await this.api.practicar(captura, signal);
      if (control.signal.aborted) return;
      this.reintento = undefined;
      const r = guardada.resultado;
      let texto = 'No hay suficientes puntos continuos de la mano y los hombros. Repite la toma.';
      if ('ejecucion' in r && r.ejecucion) {
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
        texto = [
          `Puntaje: ${resultado.puntaje_global}/100. ${resultado.estrellas}/3 estrellas. ${resultado.veredicto_aprobado ? 'Aprobado.' : 'Sigue practicando.'}`,
          ...consejos,
        ].join(' ');
      } else if (r.similitud) texto = this.mostrarSimilitud(r.similitud);
      if ('candidatas' in r && r.candidatas.length) {
        texto = `Sugerencia experimental: ${r.candidatas[0].glosa}. ` + texto;
      }
      if (r.estado === 'sin_referencias')
        texto = 'No hay plantillas disponibles para reconocer esta toma.';
      this.salida.textContent = texto + ' Intento guardado en tu historial.';
      this.vista?.mostrar(guardada);
      if (typeof window !== 'undefined')
        window.dispatchEvent?.(new Event('visenia:practice-saved'));
    } catch {
      if (!control.signal.aborted) {
        this.vista?.limpiar('error');
        this.salida.textContent =
          'No se pudo completar el guardado. Pulsa Reintentar para enviar la misma toma.';
      }
    } finally {
      if (this.pendiente === control) {
        this.pendiente = undefined;
        this.boton.disabled = false;
        this.boton.textContent = this.reintento ? 'Reintentar' : 'Probar seña';
      }
    }
  }
}
