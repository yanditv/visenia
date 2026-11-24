import { clienteLsec } from '../../../../contracts/typescript/cliente-lsec';

const xpPorNivel = 100;
const hitosDeVocabulario = [1, 5, 10, 20, 40];

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
      const pendientes = ruta.meta_diaria - ruta.hoy;
      documento.getElementById('meta-nota')!.textContent =
        pendientes <= 0
          ? 'Meta diaria completada'
          : pendientes === 1
            ? 'Falta un intento con nota.'
            : `Faltan ${pendientes} intentos con nota.`;
      documento.getElementById('racha-valor')!.textContent = String(ruta.racha);
      documento.getElementById('xp-valor')!.textContent = `${ruta.xp.toLocaleString('es-EC')} XP`;
      const nivel = 1 + Math.floor(ruta.xp / xpPorNivel);
      const avance = ruta.xp % xpPorNivel;
      documento.getElementById('nivel-valor')!.textContent = `Nivel de práctica ${nivel}`;
      const barraNivel = documento.getElementById('nivel-progreso') as HTMLProgressElement;
      barraNivel.max = xpPorNivel;
      barraNivel.value = avance;
      documento.getElementById('nivel-nota')!.textContent =
        `Faltan ${xpPorNivel - avance} XP para el nivel ${nivel + 1}.`;
      estado.textContent = '';
      const notas = new Map<string, number>();
      for (const seña of progreso.senas) {
        if (seña.id_referencia && seña.mejor !== null) {
          notas.set(seña.id_referencia, Math.max(notas.get(seña.id_referencia) ?? 0, seña.mejor));
        }
      }
      const distintas = notas.size;
      const alcanzado = hitosDeVocabulario.filter((hito) => hito <= distintas).at(-1);
      const siguiente = hitosDeVocabulario.find((hito) => hito > distintas);
      documento.getElementById('reto-valor')!.textContent =
        distintas === 1 ? '1 seña con nota' : `${distintas} señas con nota`;
      documento.getElementById('reto-nota')!.textContent = !alcanzado
        ? 'Consigue tu primera nota para alcanzar el primer hito.'
        : siguiente
          ? `Hito de ${alcanzado} completado. Llega a ${siguiente} señas para el siguiente.`
          : 'Completaste el reto de 40 señas distintas.';
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
  ventana.addEventListener('online', () => void cargar());
  void cargar();
}
