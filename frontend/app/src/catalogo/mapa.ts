import type { Nivel } from './catalogo-service';
import { mapa, themes } from '../../i18n/es-EC/mensajes';

export function renderLevelMap(
  document: Document,
  unit: number,
  references: Nivel[],
  isDemo: (reference: Nivel) => boolean,
  onStart: (referenceId: string) => void | Promise<void>,
  selectedReferenceId?: string,
  mejoresNotas: ReadonlyMap<string, number> = new Map(),
  conservarSeleccion = false
): void {
  const view = document.getElementById('map-view')!;
  const path = document.getElementById('level-path')!;
  const title = document.getElementById('map-title')!;
  const detail = document.getElementById('level-title')!;
  const description = document.getElementById('level-description')!;
  const start = document.getElementById('btn-start-level') as HTMLButtonElement;
  const [name, subtitle, icon] = themes[unit - 1];
  const mismaUnidad = conservarSeleccion && view.dataset.unit === String(unit);
  const seleccionAbierta = mismaUnidad && view.dataset.selection === 'true';
  const referenciaAnterior = mismaUnidad ? view.dataset.reference : undefined;
  view.dataset.unit = String(unit);
  view.dataset.selection = 'false';
  delete view.dataset.reference;
  title.textContent = name;
  document.getElementById('map-unit')!.textContent = mapa.unidad(unit);
  document.getElementById('map-description')!.textContent = subtitle;
  document.getElementById('map-icon')!.textContent = icon;
  document.getElementById('map-availability')!.textContent = mapa.disponibles(references.length);
  path.replaceChildren();
  start.disabled = references.length === 0;
  detail.textContent = mapa.sinNiveles;
  description.textContent = mapa.proximamenteDescripcion;
  start.onclick = null;

  const select = (reference: Nivel, index: number) => {
    view.dataset.reference = reference.id;
    detail.textContent = reference.glosa;
    description.textContent =
      'estado' in reference
        ? 'Practica con una referencia experimental y recibe una calificación de similitud.'
        : isDemo(reference)
          ? mapa.demostracion
          : mapa.observa;
    start.disabled = false;
    start.onclick = () => onStart(reference.id);
    for (const node of path.querySelectorAll<HTMLButtonElement>('.level-node')) {
      node.setAttribute('aria-pressed', String(node.dataset.reference === reference.id));
    }
    document.getElementById('level-number')!.textContent = mapa.nivel(index + 1);
  };

  for (let index = 0; index < Math.max(6, references.length); index++) {
    const reference = references[index];
    const item = document.createElement('li');
    item.className = 'level-stop';
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'level-node';
    node.textContent = reference ? String(index + 1).padStart(2, '0') : '—';
    node.disabled = !reference;
    node.dataset.reference = reference?.id ?? '';
    node.setAttribute('aria-label', mapa.etiqueta(index + 1, reference?.glosa));
    const label = document.createElement('span');
    label.className = 'level-name';
    label.textContent = reference?.glosa ?? mapa.proximamente;
    const state = document.createElement('span');
    state.className = 'level-state';
    const nota = reference ? mejoresNotas.get(reference.id) : undefined;
    if (nota !== undefined) {
      node.dataset.practicado = 'true';
      node.setAttribute('aria-label', `${reference.glosa}. Mejor nota ${nota} sobre 100`);
    }
    item.dataset.available = String(Boolean(reference));
    state.textContent =
      nota !== undefined
        ? `Mejor ${nota.toLocaleString('es-EC')}/100`
        : reference
          ? mapa.disponible
          : mapa.inhabilitado;
    node.addEventListener('click', () => {
      view.dataset.selection = 'true';
      select(reference, index);
      start.focus();
    });
    item.append(node, label, state);
    path.appendChild(item);
  }
  const preferredReference = selectedReferenceId ?? referenciaAnterior;
  const selectedIndex = references.findIndex((reference) => reference.id === preferredReference);
  const nextIndex = references.findIndex((reference) => !mejoresNotas.has(reference.id));
  const index = selectedIndex >= 0 ? selectedIndex : Math.max(0, nextIndex);
  if (references.length) {
    select(references[index], index);
    if (seleccionAbierta && selectedIndex >= 0) view.dataset.selection = 'true';
  } else document.getElementById('level-number')!.textContent = mapa.pendiente;
}
