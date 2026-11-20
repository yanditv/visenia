import type { ReferenciaSenaData } from '../src/anotador/annotation-service';
import { mapa, themes } from '../i18n/es-EC/mensajes';

let resizeObserver: ResizeObserver | undefined;

export function renderLevelMap(
  document: Document,
  unit: number,
  references: ReferenciaSenaData[],
  isDemo: (reference: ReferenciaSenaData) => boolean,
  onStart: (referenceId: string) => void | Promise<void>,
  selectedReferenceId?: string
): void {
  const view = document.getElementById('map-view')!;
  const path = document.getElementById('level-path')!;
  const title = document.getElementById('map-title')!;
  const detail = document.getElementById('level-title')!;
  const description = document.getElementById('level-description')!;
  const start = document.getElementById('btn-start-level') as HTMLButtonElement;
  const [name, subtitle, icon] = themes[unit - 1];
  view.dataset.unit = String(unit);
  view.dataset.selection = 'false';
  document.getElementById('btn-close-level')!.onclick = () => {
    view.dataset.selection = 'false';
    path.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  };
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

  const select = (reference: ReferenciaSenaData, index: number) => {
    detail.textContent = reference.glosa;
    description.textContent = isDemo(reference) ? mapa.demostracion : mapa.observa;
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
    node.textContent = reference ? String(index + 1) : '🔒';
    node.disabled = !reference;
    node.dataset.reference = reference?.id ?? '';
    node.setAttribute('aria-label', mapa.etiqueta(index + 1, reference?.glosa));
    const label = document.createElement('span');
    label.className = 'level-name';
    label.textContent = reference?.glosa ?? mapa.proximamente;
    const state = document.createElement('span');
    state.className = 'level-state';
    state.textContent = reference ? mapa.disponible : mapa.inhabilitado;
    node.addEventListener('click', () => {
      view.dataset.selection = 'true';
      select(reference, index);
      start.focus();
    });
    item.append(node, label, state);
    path.appendChild(item);
  }
  const selectedIndex = Math.max(
    0,
    references.findIndex((reference) => reference.id === selectedReferenceId)
  );
  if (references.length) select(references[selectedIndex], selectedIndex);
  else document.getElementById('level-number')!.textContent = mapa.pendiente;

  const connectNodes = () => {
    const bounds = path.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    document
      .getElementById('map-lines')!
      .setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    let previous = { x: 0, y: 0 };
    let line = '';
    path.querySelectorAll('.level-node').forEach((node, index) => {
      const rect = node.getBoundingClientRect();
      const x = rect.left - bounds.left + rect.width / 2;
      const y = rect.top - bounds.top + rect.height / 2;
      const middle = (previous.y + y) / 2;
      line += index ? ` C ${previous.x} ${middle}, ${x} ${middle}, ${x} ${y}` : `M ${x} ${y}`;
      previous = { x, y };
    });
    document.getElementById('map-connector')!.setAttribute('d', line);
  };
  resizeObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(connectNodes);
    resizeObserver.observe(path);
  }
  connectNodes();
}
