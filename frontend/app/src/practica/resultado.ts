import { clienteLsec } from '../../../../contracts/typescript/cliente-lsec';
import { crearDesglose } from './desglose';
import type {
  Feedback,
  PracticaGuardada,
} from '../../../../contracts/typescript/visena-lsec.types';

const mensajesGroq: Partial<Record<Feedback['estado'], string>> = {
  sin_clave: 'El coach con IA se activa con una clave de Groq.',
  clave_invalida: 'Groq rechazó la clave configurada.',
  cuota_agotada: 'Groq alcanzó su límite de uso. Puedes volver a intentarlo más tarde.',
  no_disponible: 'El coach con Groq está temporalmente indisponible.',
  en_espera: 'Espera un momento antes de volver a consultar a Groq.',
};

export class VistaResultado {
  private readonly api = clienteLsec();
  private readonly panel: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly coach: HTMLElement;
  private readonly texto: HTMLElement;
  private readonly botonCoach: HTMLButtonElement;
  private solicitud?: AbortController;

  constructor(private readonly doc: Document) {
    this.panel = doc.getElementById('practice-result')!;
    this.gauge = doc.getElementById('practice-gauge')!;
    this.xp = doc.getElementById('practice-xp')!;
    this.coach = doc.getElementById('feedback-card')!;
    this.texto = doc.getElementById('feedback-consejo')!;
    this.botonCoach = doc.getElementById('feedback-groq') as HTMLButtonElement;
  }

  limpiar(estado = 'idle') {
    this.solicitud?.abort();
    this.panel.dataset.state = estado;
    this.gauge.hidden = true;
    this.doc.getElementById('practice-breakdown')!.replaceChildren();
    this.xp.hidden = true;
    this.doc.getElementById('practice-announcement')!.textContent = '';
    this.coach.hidden = true;
    this.botonCoach.hidden = true;
    this.botonCoach.onclick = null;
  }

  mostrar(intento: PracticaGuardada) {
    this.limpiar('ready');
    const resultado = intento.resultado;
    const ejecucion = 'ejecucion' in resultado ? resultado.ejecucion : null;
    const nota = ejecucion?.resultado.puntaje_global ?? resultado.similitud?.puntaje;
    if (nota === undefined) return;
    const detalle = crearDesglose(this.doc, resultado);
    if (detalle) this.doc.getElementById('practice-breakdown')!.appendChild(detalle);
    this.gauge.hidden = false;
    this.doc.getElementById('practice-score')!.textContent = nota.toLocaleString('es-EC');
    this.xp.hidden = false;
    this.xp.textContent = '+10 XP';
    this.doc.getElementById('practice-announcement')!.textContent =
      `Puntaje de ${nota} sobre 100. Ganaste 10 puntos de experiencia.`;
    this.coach.hidden = false;
    const aplicada = 'calibracion_aplicada' in resultado ? resultado.calibracion_aplicada : null;
    const consejoLocal =
      aplicada && ejecucion
        ? aplicada.aspecto_a_practicar
          ? ejecucion.resultado.parametros_evaluados[aplicada.aspecto_a_practicar].mensaje_feedback
          : 'Todos los aspectos medidos están dentro del rango de referencia.'
        : resultado.similitud?.mensaje_feedback ||
          'Repite la seña a velocidad normal y compárala con la guía.';
    this.texto.textContent = consejoLocal;
    if (!resultado.similitud) return;
    const control = new AbortController();
    this.solicitud = control;
    void this.api
      .estadoFeedback()
      .then(({ groq_disponible, estado }) => {
        if (control.signal.aborted) return;
        if (!groq_disponible) {
          const mensaje = mensajesGroq[estado];
          if (mensaje) this.texto.textContent += ' ' + mensaje;
          return;
        }
        this.botonCoach.hidden = false;
        this.botonCoach.disabled = false;
        this.botonCoach.textContent = 'Ampliar con Groq';
        this.botonCoach.onclick = async () => {
          this.botonCoach.disabled = true;
          this.botonCoach.textContent = 'Consultando…';
          try {
            const signal = AbortSignal.any([control.signal, AbortSignal.timeout(18000)]);
            const feedback = await this.api.feedback(intento.id_intento, signal);
            if (control.signal.aborted) return;
            this.texto.textContent = feedback.consejo;
            this.botonCoach.textContent =
              feedback.fuente === 'reglas' ? 'Reintentar con Groq' : 'Consejo con IA';
            this.botonCoach.disabled = feedback.fuente !== 'reglas';
            if (feedback.fuente === 'reglas') {
              const mensaje = mensajesGroq[feedback.estado];
              if (mensaje) this.texto.textContent += ' ' + mensaje;
            }
          } catch {
            if (control.signal.aborted) return;
            this.texto.textContent = consejoLocal + ' ' + mensajesGroq.no_disponible;
            this.botonCoach.textContent = 'Reintentar con Groq';
            this.botonCoach.disabled = false;
          }
        };
      })
      .catch(() => {});
  }
}
