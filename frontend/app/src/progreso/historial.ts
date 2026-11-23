import { clienteLsec } from '../../../../contracts/typescript/cliente-lsec';

const intentosPorPagina = 20;
const fechaLocal = new Intl.DateTimeFormat('es-EC', {
  dateStyle: 'short',
  timeStyle: 'medium',
});
const formatoNota = new Intl.NumberFormat('es-EC', { maximumFractionDigits: 2 });

export function instalarHistorial(documento: Document, ventana: Window) {
  const api = clienteLsec();
  const panel = documento.getElementById('historial') as HTMLDetailsElement;
  const salida = documento.getElementById('historial-estado')!;
  const lista = documento.getElementById('historial-lista')!;
  const listaProgreso = documento.getElementById('historial-progreso')!;
  const progresoVacio = documento.getElementById('historial-progreso-vacio')!;
  const paginacion = documento.getElementById('historial-paginacion')!;
  const indicadorPagina = documento.getElementById('historial-pagina')!;
  const siguiente = documento.getElementById('historial-siguiente') as HTMLButtonElement;
  const anterior = documento.getElementById('historial-anterior') as HTMLButtonElement;
  let offset = 0;
  let solicitud = 0;
  let total = 0;
  async function cargar(pagina = offset) {
    const id = ++solicitud;
    salida.textContent = 'Cargando historial…';
    lista.setAttribute('aria-busy', 'true');
    anterior.disabled = true;
    siguiente.disabled = true;
    try {
      const [historial, progreso] = await Promise.all([api.historial(pagina), api.progreso()]);
      if (id !== solicitud) return;
      const intentos = documento.createDocumentFragment();
      for (const intento of historial.intentos) {
        const item = documento.createElement('li');
        item.className = 'history-entry';
        const r = intento.resultado;
        const nota =
          'ejecucion' in r && r.ejecucion
            ? r.ejecucion.resultado.puntaje_global
            : r.similitud?.puntaje;
        const datos = documento.createElement('div');
        datos.className = 'history-entry-data';
        const glosa = documento.createElement('strong');
        glosa.textContent = intento.glosa ?? 'Sin coincidencia';
        const fecha = documento.createElement('time');
        fecha.dateTime = intento.timestamp_utc;
        fecha.textContent = fechaLocal.format(new Date(intento.timestamp_utc));
        const tipo = documento.createElement('span');
        tipo.textContent =
          intento.tipo === 'dirigida' ? 'Práctica dirigida' : 'Reconocimiento libre';
        const meta = documento.createElement('div');
        meta.className = 'history-entry-meta';
        meta.append(tipo, fecha);
        datos.append(glosa, meta);
        const puntaje = documento.createElement('span');
        puntaje.className = 'history-grade';
        puntaje.textContent = nota == null ? 'Sin nota' : `${formatoNota.format(nota)}/100`;
        if (nota == null) puntaje.dataset.ungraded = 'true';
        item.append(datos, puntaje);
        intentos.appendChild(item);
      }
      lista.replaceChildren(intentos);
      offset = pagina;
      total = historial.total;
      paginacion.hidden = total <= intentosPorPagina;
      indicadorPagina.textContent = `Página ${Math.floor(offset / intentosPorPagina) + 1} de ${Math.ceil(total / intentosPorPagina)}`;
      const porSena = documento.createDocumentFragment();
      for (const sena of progreso.senas) {
        const item = documento.createElement('li');
        item.className = 'history-sign';
        const nombre = documento.createElement('strong');
        nombre.textContent = sena.glosa ?? 'Sin coincidencia';
        const metricas = documento.createElement('dl');
        for (const [etiqueta, valor] of [
          ['Intentos', String(sena.intentos)],
          ['Promedio', sena.promedio === null ? '—' : `${formatoNota.format(sena.promedio)}/100`],
          ['Mejor nota', sena.mejor === null ? '—' : `${formatoNota.format(sena.mejor)}/100`],
        ]) {
          const metrica = documento.createElement('div');
          const descripcion = documento.createElement('dt');
          descripcion.textContent = etiqueta;
          const dato = documento.createElement('dd');
          dato.textContent = valor;
          metrica.append(descripcion, dato);
          metricas.appendChild(metrica);
        }
        item.append(nombre, metricas);
        porSena.appendChild(item);
      }
      listaProgreso.replaceChildren(porSena);
      progresoVacio.hidden = progreso.senas.length > 0;
      const calificadas = progreso.senas.filter((s) => s.calificados > 0).length;
      salida.textContent = historial.total
        ? `${total === 1 ? '1 intento guardado' : `${total} intentos guardados`}. ${calificadas === 1 ? '1 seña con calificación' : `${calificadas} señas con calificación`}.`
        : 'Todavía no tienes intentos guardados. Completa una práctica para ver tu resultado aquí.';
    } catch {
      if (id === solicitud)
        salida.textContent =
          'No se pudo cargar el historial. Comprueba la conexión y pulsa Actualizar.';
    } finally {
      if (id === solicitud) {
        lista.removeAttribute('aria-busy');
        anterior.disabled = offset === 0;
        siguiente.disabled = offset + intentosPorPagina >= total;
      }
    }
  }
  panel.addEventListener('toggle', () => {
    if (panel.open) void cargar();
  });
  for (const id of ['nav-history', 'abrir-historial']) {
    documento.getElementById(id)!.addEventListener('click', () => {
      panel.open = true;
      panel.scrollIntoView({ block: 'start' });
      panel.querySelector('summary')?.focus({ preventScroll: true });
    });
  }
  documento.getElementById('historial-actualizar')!.addEventListener('click', () => void cargar());
  anterior.addEventListener('click', () => {
    void cargar(Math.max(0, offset - intentosPorPagina));
  });
  siguiente.addEventListener('click', () => {
    if (offset + intentosPorPagina >= total) return;
    void cargar(offset + intentosPorPagina);
  });
  ventana.addEventListener('visenia:practice-saved', () => {
    if (panel.open) void cargar(0);
    else offset = 0;
  });
  for (const formato of ['json', 'csv'] as const) {
    const boton = documento.getElementById('historial-' + formato) as HTMLButtonElement;
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      try {
        const archivo = await api.exportar(formato);
        const url = URL.createObjectURL(archivo);
        const enlace = documento.createElement('a');
        enlace.href = url;
        enlace.download = 'visenia-resultados.' + formato;
        enlace.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        salida.textContent = 'No se pudo exportar. Comprueba la conexión y vuelve a intentar.';
      } finally {
        boton.disabled = false;
      }
    });
  }
}
