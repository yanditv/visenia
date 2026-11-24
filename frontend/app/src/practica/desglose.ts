import type {
  Parametro,
  PracticaGuardada,
} from '../../../../contracts/typescript/visena-lsec.types';

const etiquetas: Record<Parametro, string> = {
  queirema_configuracion: 'Forma de los dedos',
  kinema_orientacion: 'Orientación de la palma',
  toponema_ubicacion: 'Ubicación de la mano',
  kinesema_movimiento: 'Recorrido',
  prosoponema_no_manual: 'Expresión facial',
};
const estados = { verde: 'Dentro del rango', amarillo: 'Por ajustar', rojo: 'Fuera del rango' };
const formato = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 });

export function crearDesglose(doc: Document, r: PracticaGuardada['resultado']) {
  const evaluacion = 'ejecucion' in r ? r : undefined;
  const veredicto = evaluacion?.ejecucion?.resultado;
  if (!veredicto && !r.similitud) return null;
  const detalle = doc.createElement('details');
  detalle.className = 'score-breakdown';
  const titulo = doc.createElement('summary');
  titulo.textContent = veredicto ? 'Evaluación calibrada por aspecto' : 'Similitud por aspecto';
  const lista = doc.createElement('dl');
  for (const key of Object.keys(etiquetas) as Parametro[]) {
    const fila = doc.createElement('div');
    const concepto = doc.createElement('dt');
    const dato = doc.createElement('dd');
    if (veredicto) {
      const metrica = veredicto.parametros_evaluados[key];
      if (!metrica || evaluacion?.parametros[key]?.estado === 'no_aplica') continue;
      const parcial = evaluacion?.calibracion_aplicada?.por_parametro[key]?.puntaje;
      dato.textContent =
        parcial == null
          ? estados[metrica.estado]
          : `${formato.format(parcial)}/100 · ${estados[metrica.estado]}`;
    } else {
      const parcial = r.similitud?.por_parametro[key];
      if (parcial == null) continue;
      dato.textContent = `${formato.format(parcial)}/100`;
    }
    concepto.textContent = etiquetas[key];
    fila.append(concepto, dato);
    lista.appendChild(fila);
  }
  detalle.append(titulo, lista);
  const aplicada = evaluacion?.calibracion_aplicada;
  const nota = doc.createElement('p');
  if (veredicto) {
    nota.textContent = veredicto.veredicto_aprobado ? 'Aprobado.' : 'Sigue practicando.';
    if (aplicada) {
      const minimo = formato.format(aplicada.puntaje_minimo);
      const aspecto = aplicada.aspecto_a_practicar;
      if (
        !veredicto.veredicto_aprobado &&
        veredicto.puntaje_global >= aplicada.puntaje_minimo &&
        aspecto
      ) {
        nota.textContent += ` Alcanzaste el mínimo de ${minimo}/100. El aspecto «${etiquetas[aspecto]}» quedó fuera del rango permitido.`;
      } else {
        nota.textContent += ` La aprobación requiere ${minimo}/100 y todos los aspectos dentro del rango verde o amarillo.`;
      }
    }
  } else {
    nota.textContent =
      'La nota es el promedio de similitud con la plantilla en los aspectos medidos.';
  }
  detalle.appendChild(nota);
  return detalle;
}
