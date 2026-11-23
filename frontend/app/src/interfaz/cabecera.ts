export function instalarCabecera(documento: Document) {
  const menus = [...documento.querySelectorAll<HTMLDetailsElement>('.header-actions > details')];

  for (const menu of menus) {
    const resumen = menu.querySelector('summary')!;
    resumen.addEventListener('click', () => {
      for (const otro of menus) if (otro !== menu) otro.open = false;
    });
    menu.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape' && menu.open) {
        menu.open = false;
        resumen.focus();
        evento.stopPropagation();
      }
    });
    menu.addEventListener('click', (evento) => {
      if (evento.target instanceof Element && evento.target.closest('button')) {
        menu.open = false;
        if (menu.contains(documento.activeElement)) resumen.focus();
      }
    });
  }
  documento.addEventListener('click', (evento) => {
    if (evento.target instanceof Node)
      for (const menu of menus) if (menu.open && !menu.contains(evento.target)) menu.open = false;
  });
}
