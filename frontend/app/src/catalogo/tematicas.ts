import { themes } from '../../i18n/es-EC/mensajes';
import type { Nivel } from './catalogo-service';

export function renderThemes(
  document: Document,
  getCatalog: (unit: number) => readonly Nivel[],
  mejoresNotas: ReadonlyMap<string, number>,
  openUnit: (unit: number, referenceId?: string) => void
): void {
  const themesGrid = document.getElementById('tematicas-grid')!;
  const focused = (document.activeElement as HTMLElement | null)?.dataset.unit;
  themesGrid.replaceChildren();
  let disponibles = 0;
  let siguiente: { unidad: number; glosa: string; id: string } | undefined;
  themes.forEach(([name, description, icon], index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.unit = String(index + 1);
    const refs = getCatalog(index + 1);
    if (refs.length) disponibles++;
    const practicadas = refs.filter((ref) => mejoresNotas.has(ref.id)).length;
    const pendiente = refs.find((ref) => !mejoresNotas.has(ref.id));
    if (!siguiente && pendiente)
      siguiente = { unidad: index + 1, glosa: pendiente.glosa, id: pendiente.id };
    card.dataset.available = String(refs.length > 0);
    for (const [className, text] of [
      ['theme-icon', icon],
      ['theme-name', name],
      ['theme-description', description],
      [
        'theme-count',
        refs.length ? `${practicadas} de ${refs.length} practicadas` : 'Próximamente',
      ],
    ]) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      if (className === 'theme-icon') span.setAttribute('aria-hidden', 'true');
      card.appendChild(span);
    }
    if (refs.length) {
      const progress = document.createElement('progress');
      progress.max = refs.length;
      progress.value = practicadas;
      progress.setAttribute('aria-label', `Progreso en ${name}`);
      card.appendChild(progress);
    }
    card.addEventListener('click', () => openUnit(index + 1));
    themesGrid.appendChild(card);
    if (card.dataset.unit === focused) card.focus({ preventScroll: true });
  });
  document.getElementById('tematicas-disponibles')!.textContent = disponibles
    ? `${disponibles} disponibles`
    : '';
  const continuar = document.getElementById('continuar-practica')!;
  continuar.textContent = siguiente
    ? mejoresNotas.size
      ? `Continuar con ${siguiente.glosa}`
      : 'Empezar a practicar'
    : 'Ver temáticas';
  const destino = siguiente;
  continuar.onclick = destino
    ? (event) => {
        event.preventDefault();
        openUnit(destino.unidad, destino.id);
      }
    : null;
}
