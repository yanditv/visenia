"use strict";

// Development-only browser harness for the documented WebSocket protocol.
const elements = Object.fromEntries(
  ["target", "demo-link", "sign-guide", "hand-guide", "score-note", "teaching-video", "demonstration", "connect", "retry", "disconnect", "status", "capture-count", "preview", "summary", "technical-summary", "result"]
    .map((id) => [id, document.getElementById(id)])
);
const signs = {
  drink: { name: "DRINK (beber)", url: "https://www.handspeak.com/word/0627/", guide: "Observa la primera variante verbal: mano dominante en C hacia los labios.", hand: "right" },
  hello: { name: "HELLO (hola)", url: "https://www.handspeak.com/word/1015/", guide: "Observa la mano plana cerca de la cabeza y su movimiento hacia afuera.", hand: "right" },
  water: { name: "WATER (agua)", url: "https://www.handspeak.com/word/2360/", guide: "Observa la forma W y los toques en el mentón.", hand: "either" },
  eat: { name: "EAT (comer)", url: "https://www.handspeak.com/word/645/", guide: "Observa la mano en O plana y los dos toques en los labios.", hand: "either" },
  please: { name: "PLEASE (por favor)", url: "https://www.handspeak.com/word/1658/", guide: "Observa la mano plana y el movimiento circular sobre el pecho.", hand: "either" },
  "thank you": { name: "THANK YOU (gracias)", url: "https://www.handspeak.com/word/2186/", guide: "Observa la mano plana que parte del mentón y se mueve hacia afuera.", hand: "either" },
  sorry: { name: "SORRY (lo siento)", url: "https://www.handspeak.com/word/2027/", guide: "Observa la mano en A y el movimiento circular sobre el pecho.", hand: "either" },
};
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
let socket = null;
let stream = null;
let timer = null;
let active = false;
let starting = false;
let countingDown = false;
let awaitingFinal = false;
let countdownTimer = null;
let autoEndTimer = null;
let startAckTimer = null;
let videoFrameRequest = null;
let captureRun = 0;
let sentFrames = 0;
let lastMediaTime = -1;
let lastSentAt = -Infinity;
let restartAfterReset = false;
let ready = false;
let sequence = 0;
let lastTimestamp = 0;
let origin = 0;
let teachingVideoUrl = null;
const requiredServerBuild = "asl-camera-20261108-11";

elements["teaching-video"].addEventListener("change", () => {
  if (teachingVideoUrl) URL.revokeObjectURL(teachingVideoUrl);
  const file = elements["teaching-video"].files?.[0];
  teachingVideoUrl = file ? URL.createObjectURL(file) : null;
  elements.demonstration.src = teachingVideoUrl ?? "";
});

function status(message) {
  elements.status.textContent = message;
}

function buttons() {
  elements.connect.disabled = socket !== null;
  elements.retry.disabled = !ready || active || starting || countingDown || awaitingFinal;
  elements.disconnect.disabled = socket === null;
  elements.target.disabled = socket !== null;
}

function control(type) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, protocol_version: "2.0" }));
  }
}

function stopLocal() {
  clearTimeout(countdownTimer);
  clearTimeout(autoEndTimer);
  clearTimeout(startAckTimer);
  captureRun += 1;
  stopFramePump();
  starting = false;
  countingDown = false;
  awaitingFinal = false;
  active = false;
  ready = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  elements.preview.srcObject = null;
  socket = null;
  buttons();
}

function glossName(gloss) {
  return signs[gloss]?.name ?? (gloss ? gloss.toUpperCase() : "la seña seleccionada");
}

function updateTargetInfo() {
  const gloss = elements.target.value;
  const sign = signs[gloss];
  if (!sign) return;
  elements["demo-link"].href = sign.url;
  elements["demo-link"].textContent = `Mira la demostración de ${sign.name}`;
  elements["sign-guide"].textContent = sign.guide;
  elements["hand-guide"].textContent = sign.hand === "right"
    ? `Esta práctica de ${sign.name} pide la mano derecha.`
    : "Usa tu mano dominante y mantén visibles el torso y la mano durante la seña.";
}

elements.target.addEventListener("change", updateTargetInfo);
updateTargetInfo();

function technicalResult(message) {
  const quality = message.quality;
  const recognition = message.recognition;
  const predictions = (recognition.top_k ?? []).map((item) =>
    `${item.gloss}: ${(item.score * 100).toFixed(1)}%`
  );
  const serviceStatus = {
    used: "utilizado", not_used: "sin usar", unavailable: "no configurado",
    error: "falló",
  };
  return [
    `Imágenes recibidas: ${quality.frames_received}. Procesadas: ${quality.frames_processed}. Descartadas: ${quality.frames_dropped}.`,
    `Imágenes disponibles para el modelo: ${quality.window_frames}.`,
    `Detección: mano izquierda ${quality.left_hand_coverage_pct}%, mano derecha ${quality.right_hand_coverage_pct}%, torso ${quality.pose_coverage_pct}%.`,
    `Mayor tiempo sin detección: mano izquierda ${quality.left_hand_longest_missing_gap_seconds} s, mano derecha ${quality.right_hand_longest_missing_gap_seconds} s, torso ${quality.pose_longest_missing_gap_seconds} s.`,
    `Modelo ASL: ${recognition.model}. Estado: ${recognition.status}.`,
    "Puntuación de ejecución: pendiente de validación con ejemplos etiquetados.",
    ...(message.services ? [`Servicios: MediaPipe ${serviceStatus[message.services.mediapipe]}, modelo ASL ${serviceStatus[message.services.asl_model]}, Groq ${serviceStatus[message.services.groq]}.`] : []),
    ...(message.observations ? [`Se observó una mano acercándose a la boca: ${message.observations.hand_to_mouth ? "sí" : "no"}.`] : []),
    ...(message.observations?.hands_to_mouth ? [`Mano izquierda hacia la boca: ${message.observations.hands_to_mouth.left ? "sí" : "no"}; derecha: ${message.observations.hands_to_mouth.right ? "sí" : "no"}. Mano solicitada: ${message.observations.practice_hand}.`] : []),
    ...(message.observations?.hands_near_head ? [`Mano elevada hacia la cabeza: izquierda ${message.observations.hands_near_head.left ? "sí" : "no"}; derecha ${message.observations.hands_near_head.right ? "sí" : "no"}. Mano solicitada: ${message.observations.practice_hand}.`] : []),
    ...(message.observations?.outward_movement != null ? [`Desplazamiento hacia afuera observado: ${message.observations.outward_movement ? "sí" : "no"}.`] : []),
    ...(recognition.input_window ? [`Imágenes utilizadas: ${recognition.input_window.frames}, entre ${(recognition.input_window.start_ms / 1000).toFixed(2)} y ${(recognition.input_window.end_ms / 1000).toFixed(2)} s de la toma.${recognition.input_window.focus_hand ? ` Modelo centrado en la mano ${recognition.input_window.focus_hand === "right" ? "derecha" : "izquierda"}.` : ""}`] : []),
    `Probabilidad del modelo para «${recognition.target_gloss}»: ${recognition.target_probability == null ? "no disponible" : recognition.target_probability < 0.001 ? "menos de 0,1%" : `${(recognition.target_probability * 100).toFixed(1)}%`}. No está calibrada como nota de ejecución.`,
    ...(predictions.length ? [`Clases sugeridas: ${predictions.join(", ")}.`] : []),
    `Redacción del feedback: ${message.feedback_source === "groq" ? "Groq" : "reglas locales"} (${message.feedback_status}).`,
    ...(message.feedback_model ? [`Modelo de consejos: ${message.feedback_model}.`] : []),
    ...(message.feedback_http_status ? [`Código HTTP de Groq: ${message.feedback_http_status}.`] : []),
    ...(message.feedback_diagnostic ? [`Diagnóstico: ${message.feedback_diagnostic}`] : []),
    ...(message.feedback_summary ? [`Resumen del servidor: ${message.feedback_summary}`] : []),
    ...(message.feedback ?? []).map((item) => `Observación: ${item}`),
    ...(message.warnings ?? []),
  ].join("\n");
}

function showResult(message) {
  elements.result.textContent = JSON.stringify(message, null, 2);
  if (message.type !== "evaluation.final") return false;
  const quality = message.quality;
  const recognition = message.recognition;
  const selectedSign = signs[recognition.target_gloss];
  if (!quality || !recognition || quality.window_frames === undefined || quality.pose_longest_missing_gap_seconds === undefined) {
    status("El backend del puerto 8000 sigue usando una versión anterior. Detén Uvicorn y vuelve a ejecutar start_demo.ps1 o start_with_groq.ps1.");
    return false;
  }
  const target = glossName(recognition.target_gloss);
  let title;
  let explanation;
  let nextStep;
  let state;
  if (recognition.status === "insufficient_data") {
    title = "No pudimos analizar esta toma";
    explanation = "La cámara no captó suficientes datos de la seña. Esto no indica si la hiciste bien o mal.";
    if (quality.window_frames < 4) {
      nextStep = "Comprueba que la cámara se mueva con fluidez y vuelve a grabar.";
    } else if (quality.pose_coverage_pct < 70 || quality.pose_longest_missing_gap_seconds > 0.35) {
      nextStep = "Muestra los hombros y el torso durante toda la seña. Luego vuelve a grabar.";
    } else {
      nextStep = "Mantén visible la mano que hace la seña mientras la realizas. Luego vuelve a grabar.";
    }
    state = "retry";
  } else if (recognition.status === "error") {
    title = "No pudimos completar el análisis";
    explanation = "Ocurrió un problema al procesar esta toma. No hay un resultado sobre tu seña.";
    nextStep = "Pulsa «Reintentar». Si el problema continúa, reinicia el servidor.";
    state = "retry";
  } else if (message.observations?.practice_hand_status === "opposite_hand") {
    title = "Se detectó la mano opuesta";
    explanation = recognition.target_gloss === "hello"
      ? "La mano izquierda se elevó junto a la cabeza. Este ejercicio pide usar la mano derecha."
      : "La mano izquierda se acercó a la boca. Este ejercicio pide usar la mano derecha.";
    nextStep = "Repite el movimiento con la mano derecha.";
    state = "retry";
  } else if (recognition.target_gloss === "hello" && message.observations?.practice_hand_status === "matching_hand") {
    const suggestedHello = recognition.top_k?.[0]?.gloss === "hello";
    if (message.observations.outward_movement === false) {
      title = "No se observó el movimiento hacia afuera";
      explanation = `La mano derecha se elevó junto a la cabeza, pero la toma no mostró un desplazamiento sostenido hacia afuera. ${suggestedHello ? "El modelo sugirió HELLO; esto no confirma su ejecución." : "El modelo tampoco confirmó HELLO."}`;
      nextStep = "Revisa la dirección en la demostración y repite el intento.";
    } else if (message.observations.outward_movement === true) {
      title = "Se observó la dirección esperada";
      explanation = `La mano derecha se elevó junto a la cabeza y se movió hacia afuera. ${suggestedHello ? "El modelo también sugirió HELLO." : "El modelo no confirmó HELLO."} Aún falta evaluar la forma y la orientación de la mano.`;
      nextStep = "Compara la forma de la mano con la demostración o pide una revisión a alguien que conozca ASL.";
    } else {
      title = "Se detectó la mano indicada";
      explanation = "La mano derecha se elevó junto a la cabeza. La dirección y la seña completa no pudieron confirmarse.";
      nextStep = "Repite el movimiento mirando la demostración.";
    }
    state = "uncertain";
  } else if (message.observations?.practice_hand_status === "matching_hand") {
    const suggestedTarget = recognition.top_k?.[0]?.gloss === recognition.target_gloss;
    title = suggestedTarget ? `El modelo sugirió ${target}` : "Se detectó la mano indicada";
    explanation = suggestedTarget
      ? "La mano derecha se acercó a la boca y el modelo sugirió DRINK. Esto aún no verifica toda la seña."
      : "La mano derecha se acercó a la boca. El modelo no confirmó DRINK, así que todavía no hay una evaluación completa de la seña.";
    nextStep = "Puedes repetirla para revisar la forma y la orientación con una persona que conozca ASL.";
    state = "uncertain";
  } else if (recognition.status === "experimental" && recognition.top_k?.[0]?.gloss === recognition.target_gloss) {
    title = `El sistema sugirió ${target}`;
    explanation = "La cámara registró tu seña. Este resultado no indica si la hiciste correctamente.";
    nextStep = "Puedes practicar de nuevo o pedir a alguien que conozca la lengua de señas que la revise.";
    state = "result";
  } else if (recognition.status === "experimental") {
    title = `No hay un resultado concluyente para ${target}`;
    explanation = "La cámara registró tu seña, pero el sistema sugirió otra palabra. Esto no significa que la hayas hecho mal: la grabación no se comparó con la demostración.";
    nextStep = "Revisa la demostración y, si quieres, graba otro intento.";
    state = "uncertain";
  } else {
    title = "No pudimos interpretar el resultado";
    explanation = "El servidor devolvió un resultado incompleto. No hay una conclusión sobre tu seña.";
    nextStep = "Pulsa «Reintentar».";
    state = "retry";
  }
  const hasGroqAdvice = message.feedback_source === "groq" &&
    message.feedback_status === "ok" && Array.isArray(message.feedback_recommendations);
  const adviceSummary = hasGroqAdvice ? message.feedback_summary : null;
  const adviceTips = hasGroqAdvice && message.observations?.practice_hand_status !== "opposite_hand" &&
    !(recognition.target_gloss === "hello" && message.observations?.outward_movement === false)
    ? message.feedback_recommendations : [];
  elements.summary.textContent = [
    title,
    explanation,
    ...(message.observations?.hand_to_mouth && !message.observations?.practice_hand_status ? ["Lo que sí observamos: una mano se acercó a tu boca."] : []),
    ...(adviceSummary ? [`Comentario: ${adviceSummary}`] : []),
    `Qué puedes hacer: ${adviceTips.length ? adviceTips.join(" ") : nextStep}`,
    ...(recognition.status === "experimental" && selectedSign ? [`En la demostración: ${selectedSign.guide}`] : []),
  ].join("\n\n");
  elements.summary.dataset.state = state;
  elements["technical-summary"].textContent = technicalResult(message);
  return true;
}

function finishAttempt() {
  if (!active) return;
  if (sentFrames < 16) {
    cancelAttempt(`La cámara solo envió ${sentFrames} imágenes. Mantén esta pestaña visible y comprueba que la vista de cámara se mueva con fluidez; luego pulsa «Reintentar».`);
    return;
  }
  clearTimeout(autoEndTimer);
  stopFramePump();
  active = false;
  awaitingFinal = true;
  control("evaluation.end");
  status("Analizando tu grabación; puede tardar unos segundos…");
  buttons();
}

function startCountdown() {
  if (!ready || countingDown || starting || active || awaitingFinal) return;
  if (document.visibilityState !== "visible") {
    status("Mantén esta pestaña visible y pulsa «Reintentar» para iniciar la toma.");
    return;
  }
  countingDown = true;
  sentFrames = 0;
  elements.summary.textContent = "Preparando tu toma…";
  elements.summary.dataset.state = "idle";
  elements["technical-summary"].textContent = "—";
  elements["capture-count"].textContent = "Preparando la toma; aún no se envían imágenes.";
  let seconds = 5;
  status(`Prepárate y mantén la mano y el torso en cuadro. Comienza en ${seconds}…`);
  buttons();
  const tick = () => {
    if (!countingDown || socket?.readyState !== WebSocket.OPEN) return;
    seconds -= 1;
    if (seconds > 0) {
      status(`Comienza en ${seconds}…`);
      countdownTimer = setTimeout(tick, 1000);
      return;
    }
    countingDown = false;
    starting = true;
    control("evaluation.begin");
    status("Preparando la captura…");
    startAckTimer = setTimeout(() => cancelAttempt("El servidor no confirmó el inicio. Pulsa «Reintentar»."), 8000);
    buttons();
  };
  countdownTimer = setTimeout(tick, 1000);
}

function stopFramePump() {
  clearTimeout(timer);
  timer = null;
  if (videoFrameRequest !== null) elements.preview.cancelVideoFrameCallback(videoFrameRequest);
  videoFrameRequest = null;
}

function cancelAttempt(message) {
  captureRun += 1;
  stopFramePump();
  clearTimeout(countdownTimer);
  clearTimeout(autoEndTimer);
  clearTimeout(startAckTimer);
  active = starting = countingDown = false;
  restartAfterReset = false;
  control("evaluation.reset");
  status(message);
  elements["capture-count"].textContent = `Captura cancelada: ${sentFrames} imágenes enviadas.`;
  elements.summary.textContent = message;
  elements.summary.dataset.state = "retry";
  elements["technical-summary"].textContent = "—";
  buttons();
}

function scheduleFrame(run) {
  if (!active || run !== captureRun) return;
  const next = async (_now, metadata) => {
    videoFrameRequest = null;
    await sendFrame(run, metadata?.mediaTime ?? elements.preview.currentTime);
    scheduleFrame(run);
  };
  if (typeof elements.preview.requestVideoFrameCallback === "function") {
    videoFrameRequest = elements.preview.requestVideoFrameCallback(next);
  } else {
    timer = setTimeout(next, 1000 / 30);
  }
}

async function sendFrame(run, mediaTime) {
  if (!active || run !== captureRun || socket?.readyState !== WebSocket.OPEN || !context) return;
  if (document.visibilityState !== "visible") {
    cancelAttempt("La toma se canceló al salir de esta pestaña. Regresa y pulsa «Reintentar»; mantén la página visible durante la seña.");
    return;
  }
  if (elements.preview.readyState < 2 || mediaTime === lastMediaTime || performance.now() - lastSentAt < 30) return;
  try {
    const capturedAt = performance.now();
    context.drawImage(elements.preview, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
    if (!blob || !active || run !== captureRun) return;
    const jpeg = await blob.arrayBuffer();
    if (!active || run !== captureRun) return;
    const timestamp = Math.max(lastTimestamp + 1, Math.round(capturedAt - origin));
    lastTimestamp = timestamp;
    const packet = new ArrayBuffer(12 + jpeg.byteLength);
    const view = new DataView(packet);
    view.setBigUint64(0, BigInt(timestamp), true);
    view.setUint32(8, ++sequence, true);
    new Uint8Array(packet, 12).set(new Uint8Array(jpeg));
    socket.send(packet);
    sentFrames += 1;
    lastMediaTime = mediaTime;
    lastSentAt = capturedAt;
    elements["capture-count"].textContent = `Capturando: ${sentFrames} imágenes enviadas. Mantén esta pestaña visible.`;
  } catch (error) {
    cancelAttempt(`No se pudo capturar la cámara: ${error.message}`);
  }
}

elements.connect.addEventListener("click", async () => {
  const gloss = elements.target.value;
  const sign = signs[gloss];
  if (!sign) { status("Selecciona una seña del catálogo."); return; }
  elements.target.disabled = true;
  try {
    status("Solicitando cámara…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
    elements.preview.srcObject = stream;
    await elements.preview.play();
    const scale = Math.min(640 / elements.preview.videoWidth, 480 / elements.preview.videoHeight, 1);
    canvas.width = Math.round(elements.preview.videoWidth * scale);
    canvas.height = Math.round(elements.preview.videoHeight * scale);
    origin = performance.now();
    sequence = 0;
    lastTimestamp = 0;
    socket = new WebSocket("ws://127.0.0.1:8000/ws/v2/visena/recognize");
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        type: "session.start",
        protocol_version: "2.0",
        target_gloss: gloss,
        practice_hand: sign.hand,
        capture: {
          width: canvas.width,
          height: canvas.height,
          fps: 30,
          frame_encoding: "jpeg",
        },
      }));
      status("Cámara conectada. Esperando confirmación del backend…");
    });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); }
      catch { status("Respuesta no válida del servidor."); return; }
      switch (message.type) {
        case "session.ready":
          if (message.server_build !== requiredServerBuild) {
            status("El backend del puerto 8000 sigue usando una versión anterior. Detén Uvicorn y vuelve a ejecutar start_demo.ps1 o start_with_groq.ps1.");
            ready = false;
            break;
          }
          ready = true;
          startCountdown();
          break;
        case "evaluation.started":
          if (!starting) break;
          clearTimeout(startAckTimer);
          starting = false;
          active = true;
          captureRun += 1;
          sentFrames = 0;
          lastMediaTime = -1;
          lastSentAt = -Infinity;
          status(`Haz ${sign.name} ahora; la captura termina sola en 5,5 segundos.`);
          elements["capture-count"].textContent = "Capturando… Mantén esta pestaña visible.";
          scheduleFrame(captureRun);
          autoEndTimer = setTimeout(finishAttempt, 5500);
          break;
        case "evaluation.partial":
          showResult(message);
          break;
        case "evaluation.final":
          active = false;
          awaitingFinal = false;
          clearTimeout(autoEndTimer);
          if (showResult(message)) status("Resultado listo. Puedes pulsar «Reintentar».");
          elements["capture-count"].textContent = "Captura terminada.";
          break;
        case "evaluation.reset":
          if (restartAfterReset) {
            restartAfterReset = false;
            startCountdown();
          }
          break;
        case "session.ping":
          control("session.pong");
          break;
        case "error":
          status(message.code === "INFERENCE_ERROR"
            ? "No pudimos completar el análisis. Espera el resultado final o pulsa «Reintentar»."
            : message.message || "Ocurrió un problema. Intenta otra vez.");
          elements.summary.textContent = "No pudimos completar este paso. Revisa el mensaje de la cámara e intenta otra vez.";
          elements.summary.dataset.state = "retry";
          elements.result.textContent = JSON.stringify(message, null, 2);
          break;
      }
      buttons();
    });
    socket.addEventListener("error", () => status("Error de conexión. Comprueba que Uvicorn siga encendido."));
    socket.addEventListener("close", () => {
      stopLocal();
      status("Conexión cerrada. Puedes conectar de nuevo.");
    });
    buttons();
  } catch (error) {
    stopLocal();
    status(`No se pudo abrir la cámara: ${error.message}`);
  }
});

elements.retry.addEventListener("click", () => {
  active = false;
  restartAfterReset = true;
  control("evaluation.reset");
  status("Preparando un nuevo intento…");
  buttons();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && (active || starting || countingDown)) {
    cancelAttempt("La toma se canceló al salir de esta pestaña. Regresa y pulsa «Reintentar»; mantén la página visible durante la seña.");
  }
});
elements.disconnect.addEventListener("click", () => {
  control("session.stop");
  socket?.close();
  stopLocal();
  status("Cámara y conexión cerradas.");
});
