import { clienteLsec } from '../../../../contracts/typescript/cliente-lsec';

export function instalarTrayectoria(
  documento: Document,
  ventana: Window,
  actualizar: (notas: ReadonlyMap<string, number>) => void
) {
  const api = clienteLsec();
  const estado = documento.getElementById('journey-state')!;
  const valor = documento.getElementById('meta-valor')!;
  const barra = documento.getElementById('meta-progreso') as HTMLProgressElement;
  let solicitud = 0;
  async function cargar() {
    const actual = ++solicitud;
    try {
      const [ruta, progreso] = await Promise.all([api.trayectoria(), api.progreso()]);
      if (actual !== solicitud) return;
      valor.textContent = `${Math.min(ruta.hoy, ruta.meta_diaria)}/${ruta.meta_diaria}`;
      barra.max = ruta.meta_diaria;
      barra.value = Math.min(ruta.hoy, ruta.meta_diaria);
      documento.getElementById('meta-nota')!.textContent =
        ruta.hoy >= ruta.meta_diaria
          ? 'Meta diaria completada'
          : `${ruta.meta_diaria - ruta.hoy} intentos con nota para completar la meta`;
      documento.getElementById('racha-valor')!.textContent = String(ruta.racha);
      documento.getElementById('xp-valor')!.textContent = `${ruta.xp.toLocaleString('es-EC')} XP`;
      estado.textContent = '';
      const notas = new Map<string, number>();
      for (const seña of progreso.senas) {
        if (seña.id_referencia && seña.mejor !== null) {
          notas.set(seña.id_referencia, Math.max(notas.get(seña.id_referencia) ?? 0, seña.mejor));
        }
      }
      actualizar(notas);
    } catch {
      if (actual !== solicitud) return;
      estado.textContent = 'El progreso se actualizará cuando el servidor vuelva a responder.';
    }
  }
  const toggle = documento.getElementById('mostrar-tematicas') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const abierto = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(abierto));
    documento.getElementById('tematicas-grid')!.classList.toggle('show-unavailable', abierto);
    toggle.textContent = abierto ? 'Ocultar temáticas futuras' : 'Ver temáticas futuras';
  });
  ventana.addEventListener('visenia:practice-saved', () => void cargar());
  void cargar();
}
