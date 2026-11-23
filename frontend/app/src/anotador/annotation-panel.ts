import { mensajes } from '../../i18n/es-EC/mensajes';
import type { HolisticFrameLandmarks } from '../render/skeleton-renderer';
import type { AnnotationService } from './annotation-service';

interface AnnotationPanelOptions {
  ensurePractice: () => void;
  canRecord: () => boolean;
}

export function createAnnotationPanel(
  document: Document,
  annotationService: AnnotationService,
  options: AnnotationPanelOptions
) {
  const tabPractica = document.getElementById('tab-practica') as HTMLButtonElement;
  const tabAnotador = document.getElementById('tab-anotador') as HTMLButtonElement;
  const anotadorDrawer = document.getElementById('anotador-drawer') as HTMLElement;
  anotadorDrawer.hidden = true;
  const btnCerrarAnotador = document.getElementById('btn-cerrar-anotador') as HTMLButtonElement;
  const btnRecordSena = document.getElementById('btn-record-sena') as HTMLButtonElement;
  const recordStatus = document.getElementById('record-status') as HTMLSpanElement;
  const recordCounter = document.getElementById('record-counter') as HTMLSpanElement;
  const sliderFrameInicio = document.getElementById('slider-frame-inicio') as HTMLInputElement;
  const sliderFrameFin = document.getElementById('slider-frame-fin') as HTMLInputElement;
  const lblFrameInicio = document.getElementById('lbl-frame-inicio') as HTMLElement;
  const lblFrameFin = document.getElementById('lbl-frame-fin') as HTMLElement;

  const inputGlosa = document.getElementById('input-glosa') as HTMLInputElement;
  const selectUnidad = document.getElementById('select-unidad') as HTMLInputElement;
  const selectDificultad = document.getElementById('select-dificultad') as HTMLSelectElement;
  const selectManoDom = document.getElementById('select-mano-dom') as HTMLSelectElement;
  const selectToponema = document.getElementById('select-toponema') as HTMLSelectElement;
  const selectKinesema = document.getElementById('select-kinesema') as HTMLSelectElement;
  const inputQueirema = document.getElementById('input-queirema') as HTMLInputElement;
  const inputQueiremaDesc = document.getElementById('input-queirema-desc') as HTMLInputElement;
  const inputPalmaX = document.getElementById('input-palma-x') as HTMLInputElement;
  const inputPalmaY = document.getElementById('input-palma-y') as HTMLInputElement;
  const inputPalmaZ = document.getElementById('input-palma-z') as HTMLInputElement;
  const inputRepeticiones = document.getElementById('input-repeticiones') as HTMLInputElement;
  const checkProsoponema = document.getElementById('check-prosoponema') as HTMLInputElement;
  const selectProsoponemaTarget = document.getElementById(
    'select-prosoponema-target'
  ) as HTMLSelectElement;
  const inputProsoponemaCoef = document.getElementById(
    'input-prosoponema-coef'
  ) as HTMLInputElement;
  const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;
  const exportMsg = document.getElementById('export-msg') as HTMLSpanElement;

  function close() {
    tabPractica.classList.add('active');
    tabAnotador.classList.remove('active');
    anotadorDrawer.classList.add('oculto');
    anotadorDrawer.hidden = true;
    tabAnotador.setAttribute('aria-expanded', 'false');
  }

  tabPractica.addEventListener('click', () => {
    options.ensurePractice();
    close();
  });

  tabAnotador.addEventListener('click', () => {
    options.ensurePractice();
    tabAnotador.classList.add('active');
    tabPractica.classList.remove('active');
    anotadorDrawer.classList.remove('oculto');
    anotadorDrawer.hidden = false;
    tabAnotador.setAttribute('aria-expanded', 'true');
    btnCerrarAnotador.focus();
  });

  btnCerrarAnotador.addEventListener('click', () => {
    tabPractica.click();
    document.getElementById('tools-trigger')?.focus();
  });

  // ─── Controles de Grabación de Seña ──────────────────────────────────────────
  btnRecordSena.addEventListener('click', () => {
    if (!annotationService.getIsRecording()) {
      if (!options.canRecord()) {
        recordStatus.textContent = mensajes.activarAntesDeGrabar;
        return;
      }
      annotationService.startRecording();
      btnRecordSena.textContent = mensajes.detenerGrabacion;
      btnRecordSena.classList.add('recording');
      recordStatus.textContent = mensajes.grabando;
      recordStatus.style.color = '#ef4444';
      exportMsg.textContent = '';
    } else {
      const stats = annotationService.stopRecording();
      btnRecordSena.textContent = mensajes.nuevaToma;
      btnRecordSena.classList.remove('recording');
      recordStatus.textContent = mensajes.tomaFinalizada(stats.totalFrames);
      recordStatus.style.color = '#22c55e';

      const maxIdx = Math.max(0, stats.totalFrames - 1);
      sliderFrameInicio.max = maxIdx.toString();
      sliderFrameFin.max = maxIdx.toString();
      sliderFrameInicio.value = '0';
      sliderFrameFin.value = maxIdx.toString();
      lblFrameInicio.textContent = '0';
      lblFrameFin.textContent = maxIdx.toString();
    }
  });

  sliderFrameInicio.addEventListener('input', () => {
    lblFrameInicio.textContent = sliderFrameInicio.value;
    if (parseInt(sliderFrameInicio.value) > parseInt(sliderFrameFin.value)) {
      sliderFrameFin.value = sliderFrameInicio.value;
      lblFrameFin.textContent = sliderFrameInicio.value;
    }
  });

  sliderFrameFin.addEventListener('input', () => {
    lblFrameFin.textContent = sliderFrameFin.value;
    if (parseInt(sliderFrameFin.value) < parseInt(sliderFrameInicio.value)) {
      sliderFrameInicio.value = sliderFrameFin.value;
      lblFrameInicio.textContent = sliderFrameFin.value;
    }
  });

  // ─── Exportación de JSON Schema v1.1.0 ───────────────────────────────────────
  checkProsoponema.addEventListener('change', () => {
    for (const field of [selectProsoponemaTarget, inputProsoponemaCoef]) {
      field.disabled = !checkProsoponema.checked;
      field.required = checkProsoponema.checked;
    }
  });

  btnExportJson.addEventListener('click', () => {
    const recorded = annotationService.getRecordedFrames();
    if (recorded.length === 0) {
      exportMsg.textContent = mensajes.tomaObligatoria;
      exportMsg.className = 'export-msg error';
      return;
    }

    const glosa = inputGlosa.value.trim();
    if (!glosa) {
      exportMsg.textContent = mensajes.glosaObligatoria;
      exportMsg.className = 'export-msg error';
      return;
    }

    try {
      exportMsg.textContent = '';
      const fields = [
        selectUnidad,
        inputQueirema,
        inputQueiremaDesc,
        selectToponema,
        selectKinesema,
        inputPalmaX,
        inputPalmaY,
        inputPalmaZ,
        inputRepeticiones,
        sliderFrameInicio,
        sliderFrameFin,
        ...(checkProsoponema.checked ? [selectProsoponemaTarget, inputProsoponemaCoef] : []),
      ];
      for (const field of fields) {
        if (!field.reportValidity()) return;
        if (!field.value.trim()) {
          field.focus();
          throw new Error('Completa los parámetros fonológicos antes de exportar.');
        }
      }
      const kinemaPalma: [number, number, number] = [
        Number(inputPalmaX.value),
        Number(inputPalmaY.value),
        Number(inputPalmaZ.value),
      ];
      const repeticiones = Number(inputRepeticiones.value);
      const unidad = Number(selectUnidad.value);
      const inicio = Number(sliderFrameInicio.value);
      const fin = Number(sliderFrameFin.value);
      if (!kinemaPalma.every(Number.isFinite) || kinemaPalma.every((value) => value === 0))
        throw new Error('La orientación de la palma debe ser un vector numérico distinto de cero.');
      if (!Number.isInteger(repeticiones) || repeticiones < 0)
        throw new Error('Las repeticiones deben ser un número entero mayor o igual a cero.');
      if (
        !Number.isInteger(unidad) ||
        unidad < 1 ||
        unidad > 12 ||
        !Number.isInteger(inicio) ||
        !Number.isInteger(fin)
      )
        throw new Error('Revisa la unidad temática y los límites de la seña.');
      let prosoponemaBlendshapes: Record<string, number> | undefined;
      if (checkProsoponema.checked) {
        const coefficient = Number(inputProsoponemaCoef.value);
        if (!Number.isFinite(coefficient) || coefficient < 0 || coefficient > 1)
          throw new Error('El coeficiente facial debe estar entre 0 y 1.');
        prosoponemaBlendshapes = { [selectProsoponemaTarget.value]: coefficient };
      }
      const doc = annotationService.buildReferenceDocument({
        glosa,
        unidadTematica: unidad,
        dificultad: selectDificultad.value as 'facil' | 'intermedio' | 'avanzado',
        manoDominante: selectManoDom.value as 'derecha' | 'izquierda' | 'ambas',
        anotador: 'Especialista LSE Viseña',
        frameInicioSena: inicio,
        frameFinSena: fin,
        queiremaForma: inputQueirema.value.trim(),
        queiremaDesc: inputQueiremaDesc.value.trim(),
        kinemaPalma,
        toponemaZona: selectToponema.value as any,
        kinesemaTipo: selectKinesema.value as any,
        kinesemaRepeticiones: repeticiones,
        prosoponemaRequerido: checkProsoponema.checked,
        prosoponemaBlendshapes,
      });

      annotationService.downloadJson(doc);
      exportMsg.textContent = mensajes.referenciaExportada(doc.id);
      exportMsg.className = 'export-msg success';
    } catch (err: unknown) {
      const error = err as Error;
      exportMsg.textContent = mensajes.error(error.message);
      exportMsg.className = 'export-msg error';
    }
  });

  return {
    close,
    isRecording: () => annotationService.getIsRecording(),
    setUnit: (unit: number) => {
      selectUnidad.value = String(unit);
    },
    finish: () => {
      if (annotationService.getIsRecording()) btnRecordSena.click();
    },
    record: (landmarks: HolisticFrameLandmarks) => {
      if (!annotationService.getIsRecording()) return;
      annotationService.recordFrame(landmarks);
      const frames = annotationService.getRecordedFrames();
      const last = frames.at(-1);
      if (last)
        recordCounter.textContent = mensajes.cuadros(
          frames.length,
          (last.timestamp_ms / 1000).toFixed(1)
        );
    },
  };
}
