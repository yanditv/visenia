import { preferencias } from '../i18n/es-EC/mensajes';

const size = document.querySelector<HTMLSelectElement>('#text-size')!;
const contrast = document.querySelector<HTMLInputElement>('#high-contrast')!;
const hand = document.querySelector<HTMLSelectElement>('#preferred-hand')!;
const handDisplay = document.querySelector<HTMLElement>('#preferred-hand-display')!;
const annotationHand = document.querySelector<HTMLSelectElement>('#select-mano-dom')!;
const key = 'visenia:preferencias-locales';

try {
  const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  if (['18', '21', '24'].includes(saved?.size)) size.value = saved.size;
  contrast.checked = saved?.contrast === true;
  if (['derecha', 'izquierda', 'ambas'].includes(saved?.hand)) hand.value = saved.hand;
} catch {
  // Las preferencias siguen disponibles durante la sesión si el almacenamiento está bloqueado.
}

function applyPreferences() {
  document.documentElement.style.setProperty('--vs-font-base', `${size.value}px`);
  document.documentElement.dataset.contrast = contrast.checked ? 'high' : 'normal';
  handDisplay.textContent = preferencias.manoDominante(hand.selectedOptions[0].text);
}

applyPreferences();
annotationHand.value = hand.value;
for (const field of [size, contrast, hand]) {
  field.addEventListener('change', () => {
    applyPreferences();
    if (field === hand) annotationHand.value = hand.value;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ size: size.value, contrast: contrast.checked, hand: hand.value })
      );
    } catch {
      // Los cambios ya se aplicaron a la sesión actual.
    }
  });
}
