import { animate } from 'motion/mini';

const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
const activas = new Map<HTMLElement, ReturnType<typeof animate>>();

reducirMovimiento.addEventListener('change', ({ matches }) => {
  if (!matches) return;
  for (const animacion of activas.values()) animacion.cancel();
  activas.clear();
});

function revelar(elemento: HTMLElement, retraso = 0, distancia = 16) {
  if (reducirMovimiento.matches || !elemento.animate || !elemento.isConnected) return;
  activas.get(elemento)?.cancel();
  const animacion = animate(
    elemento,
    { opacity: [0, 1], transform: [`translateY(${distancia}px)`, 'none'] },
    { duration: 0.4, delay: retraso, ease: [0.22, 1, 0.36, 1] }
  );
  activas.set(elemento, animacion);
  void animacion.then(() => {
    if (activas.get(elemento) === animacion) activas.delete(elemento);
  });
}

function revelarSecuencia(elementos: Iterable<Element>) {
  Array.from(elementos)
    .slice(0, 8)
    .forEach((elemento, indice) => {
      if (elemento instanceof HTMLElement) revelar(elemento, indice * 0.035);
    });
}

export function instalarMovimiento(documento: Document) {
  const observador = new MutationObserver((cambios) => {
    for (const elemento of new Set(cambios.map(({ target }) => target))) {
      if (!(elemento instanceof HTMLElement) || elemento.closest('[hidden]')) continue;
      if (elemento.hasAttribute('data-motion-view')) {
        revelarSecuencia(elemento.querySelectorAll('[data-motion-item]'));
      } else if (elemento.hasAttribute('data-motion-list')) {
        if (!elemento.closest('details:not([open])')) revelarSecuencia(elemento.children);
      } else {
        revelar(elemento, 0, 12);
      }
    }
  });

  for (const vista of documento.querySelectorAll<HTMLElement>('[data-motion-view]')) {
    observador.observe(vista, { attributes: true, attributeFilter: ['hidden'] });
    if (!vista.hidden) revelarSecuencia(vista.querySelectorAll('[data-motion-item]'));
  }
  for (const resultado of documento.querySelectorAll('[data-motion-result]'))
    observador.observe(resultado, { attributes: true, attributeFilter: ['hidden'] });
  for (const lista of documento.querySelectorAll('[data-motion-list]'))
    observador.observe(lista, { childList: true });
  for (const panel of documento.querySelectorAll<HTMLDetailsElement>('[data-motion-disclosure]')) {
    panel.addEventListener('toggle', () => {
      const contenido = panel.querySelector<HTMLElement>(':scope > [data-motion-content]');
      if (panel.open && contenido) revelar(contenido, 0, -12);
    });
  }
}
