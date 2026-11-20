const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(framePeriod = 34) {
  let now = 0;
  let timerId = 0;
  let socket;
  const timers = new Map();
  const schedule = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  class Surface {
    constructor() { this.listeners = {}; this.style = {}; this.dataset = {}; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    async emit(name, event = {}) { return this.listeners[name]?.(event); }
  }
  const elements = new Map();
  const document = new Surface();
  document.visibilityState = "visible";
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new Surface());
    return elements.get(id);
  };
  document.createElement = () => ({
    getContext: () => ({ drawImage() {} }),
    toBlob: (callback) => callback({ arrayBuffer: async () => new ArrayBuffer(4) }),
  });
  const preview = document.getElementById("preview");
  Object.assign(preview, {
    videoWidth: 640, videoHeight: 480, readyState: 4,
    play: async () => {},
    requestVideoFrameCallback: (callback) => schedule(() => callback(now, { mediaTime: now / 1000 }), framePeriod),
    cancelVideoFrameCallback: (id) => timers.delete(id),
  });
  document.getElementById("target").value = "drink";
  class FakeWebSocket extends Surface {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; this.sent = []; socket = this; }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../manual-test/camera.js"), "utf8"), {
    document,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    WebSocket: FakeWebSocket,
    performance: { now: () => now },
    setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
    ArrayBuffer, DataView, Uint8Array, URL,
  });
  async function advance(duration) {
    const end = now + duration;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      await next[1].fn();
    }
    now = end;
  }
  const receive = (type, extra = {}) => socket.emit("message", { data: JSON.stringify({ type, ...extra }) });
  const controls = () => socket.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item).type);
  return {
    document, elements, advance, receive, controls,
    messages: () => socket.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item)),
    packets: () => socket.sent.filter((item) => item instanceof ArrayBuffer),
    async connect() {
      await document.getElementById("connect").emit("click");
      await socket.emit("open");
      await receive("session.ready", { server_build: "asl-camera-20261108-11" });
    },
  };
}

function finalResult(overrides = {}) {
  return {
    quality: {
      frames_received: 98, frames_processed: 95, frames_dropped: 3,
      window_frames: 95, left_hand_coverage_pct: 100, right_hand_coverage_pct: 100,
      pose_coverage_pct: 100, left_hand_longest_missing_gap_seconds: 0,
      right_hand_longest_missing_gap_seconds: 0, pose_longest_missing_gap_seconds: 0,
      ...overrides.quality,
    },
    recognition: {
      status: "experimental", target_gloss: "drink", target_probability: 0.0001,
      top_k: [{ gloss: "match", score: 0.493 }], ...overrides.recognition,
    },
    feedback_source: "rules", feedback_status: "not_requested",
    feedback_http_status: null, feedback_summary: "Sin comparación con el video.",
    services: { mediapipe: "used", asl_model: "used", groq: "unavailable" },
    feedback: ["Este resultado no permite concluir que hiciste mal la seña."],
    warnings: ["La probabilidad no mide calidad de ejecución."],
  };
}

test("captures camera frames after server confirmation and ends automatically", async () => {
  const app = harness();
  await app.connect();
  await app.advance(5000);
  assert.ok(app.controls().includes("evaluation.begin"));
  assert.equal(app.packets().length, 0);
  await app.receive("evaluation.started");
  await app.advance(5500);
  assert.ok(app.packets().length >= 90);
  assert.equal(app.controls().filter((type) => type === "evaluation.end").length, 1);
});

test("selecting another ASL sign updates the guide and WebSocket target", async () => {
  const app = harness();
  app.elements.get("target").value = "water";
  await app.elements.get("target").emit("change");
  assert.equal(app.elements.get("demo-link").href, "https://www.handspeak.com/word/2360/");
  assert.match(app.elements.get("sign-guide").textContent, /forma W/);
  await app.connect();
  const start = app.messages().find((item) => item.type === "session.start");
  assert.equal(start.target_gloss, "water");
  assert.equal(start.practice_hand, "either");
  assert.equal(app.elements.get("target").disabled, true);
  await app.advance(5000);
  await app.receive("evaluation.started");
  assert.match(app.elements.get("status").textContent, /WATER \(agua\)/);
  await app.receive("evaluation.final", finalResult({ recognition: {
    target_gloss: "water", top_k: [{ gloss: "water", score: 0.6 }],
  } }));
  assert.match(app.elements.get("summary").textContent, /El sistema sugirió WATER \(agua\)/);
  assert.match(app.elements.get("summary").textContent, /En la demostración: Observa la forma W/);
});

test("a different sign keeps an uncertain model result distinct from execution", async () => {
  const app = harness();
  app.elements.get("target").value = "hello";
  await app.elements.get("target").emit("change");
  await app.connect();
  await app.receive("evaluation.final", finalResult({ recognition: {
    target_gloss: "hello", top_k: [{ gloss: "good", score: 0.7 }],
  } }));
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /No hay un resultado concluyente para HELLO \(hola\)/);
  assert.match(summary, /En la demostración: Observa la mano plana/);
  assert.doesNotMatch(summary, /mano derecha|hiciste mal/);
});

test("closing the session lets the user choose a new sign", async () => {
  const app = harness();
  await app.connect();
  await app.elements.get("disconnect").emit("click");
  assert.equal(app.elements.get("target").disabled, false);
  app.elements.get("target").value = "please";
  await app.elements.get("target").emit("change");
  await app.connect();
  assert.equal(app.messages().find((item) => item.type === "session.start").target_gloss, "please");
});

test("hiding the page cancels the capture instead of evaluating a few frames", async () => {
  const app = harness();
  await app.connect();
  await app.advance(5000);
  await app.receive("evaluation.started");
  await app.advance(100);
  app.document.visibilityState = "hidden";
  await app.document.emit("visibilitychange");
  const sent = app.packets().length;
  await app.advance(5000);
  assert.equal(app.packets().length, sent);
  assert.ok(app.controls().includes("evaluation.reset"));
  assert.ok(!app.controls().includes("evaluation.end"));
  assert.match(app.elements.get("status").textContent, /canceló al salir/);
});

test("a camera delivering five frames does not submit an unusable attempt", async () => {
  const app = harness(1000);
  await app.connect();
  await app.advance(5000);
  await app.receive("evaluation.started");
  await app.advance(5500);
  assert.equal(app.packets().length, 5);
  assert.ok(!app.controls().includes("evaluation.end"));
  assert.match(app.elements.get("status").textContent, /solo envió 5 imágenes/);
});

test("presents a mismatched model result without technical labels in the main message", async () => {
  const app = harness();
  await app.connect();
  await app.receive("evaluation.partial", finalResult());
  assert.match(app.elements.get("summary").textContent, /Preparando tu toma/);
  await app.receive("evaluation.final", finalResult());
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /No hay un resultado concluyente para DRINK \(beber\)/);
  assert.match(summary, /no significa que la hayas hecho mal/);
  assert.doesNotMatch(summary, /49\.3|0,1%|Groq|HTTP|match/);
  assert.match(app.elements.get("technical-summary").textContent, /match: 49\.3%/);
  assert.equal(app.elements.get("summary").dataset.state, "uncertain");
});

test("shows a measured hand approach without claiming the sign was correct", async () => {
  const app = harness();
  await app.connect();
  const message = finalResult();
  message.observations = { hand_to_mouth: true };
  await app.receive("evaluation.final", message);
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /una mano se acercó a tu boca/);
  assert.match(summary, /No hay un resultado concluyente/);
  assert.doesNotMatch(summary, /hiciste correctamente/);
});

test("explains the requested hand independently of a model mismatch", async () => {
  const app = harness();
  await app.connect();
  const wrong = finalResult();
  wrong.observations = {
    hand_to_mouth: true, hands_to_mouth: { left: true, right: false },
    practice_hand: "right", practice_hand_status: "opposite_hand",
  };
  wrong.feedback_source = "groq";
  wrong.feedback_status = "ok";
  wrong.feedback_summary = "Se observó la mano opuesta en este ejercicio.";
  wrong.feedback_recommendations = ["Consejo general adicional."];
  await app.receive("evaluation.final", wrong);
  assert.match(app.elements.get("summary").textContent, /mano opuesta/);
  assert.match(app.elements.get("summary").textContent, /mano derecha/);
  assert.match(app.elements.get("summary").textContent, /Repite el movimiento con la mano derecha/);
  assert.doesNotMatch(app.elements.get("summary").textContent, /Qué puedes hacer: Consejo general/);
  const matching = finalResult();
  matching.observations = {
    hand_to_mouth: true, hands_to_mouth: { left: true, right: true },
    practice_hand: "right", practice_hand_status: "matching_hand",
  };
  await app.receive("evaluation.final", matching);
  assert.match(app.elements.get("summary").textContent, /mano indicada/);
  assert.match(app.elements.get("summary").textContent, /no hay una evaluación completa/);
  assert.doesNotMatch(app.elements.get("summary").textContent, /seña correcta/);
  assert.match(app.elements.get("technical-summary").textContent, /MediaPipe utilizado/);
  matching.recognition.top_k = [{ gloss: "drink", score: 0.53 }];
  await app.receive("evaluation.final", matching);
  assert.match(app.elements.get("summary").textContent, /El modelo sugirió DRINK/);
  assert.match(app.elements.get("summary").textContent, /Esto aún no verifica toda la seña/);
});

test("shows Groq advice on a model mismatch without changing the verdict", async () => {
  const app = harness();
  await app.connect();
  const message = finalResult();
  message.feedback_source = "groq";
  message.feedback_status = "ok";
  message.feedback_summary = "El sistema no pudo confirmar la seña elegida en esta toma.";
  message.feedback_recommendations = ["Puedes repetir la práctica cuando quieras."];
  message.services.groq = "used";
  await app.receive("evaluation.final", message);
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /No hay un resultado concluyente/);
  assert.match(summary, /Comentario: El sistema no pudo confirmar/);
  assert.match(summary, /Puedes repetir la práctica/);
  assert.match(app.elements.get("technical-summary").textContent, /Groq utilizado/);
});

test("presents recognition as a system suggestion, not an execution grade", async () => {
  const app = harness();
  await app.connect();
  await app.receive("evaluation.final", finalResult({ recognition: {
    status: "experimental", target_gloss: "drink", target_probability: 0.85,
    top_k: [{ gloss: "drink", score: 0.85 }],
  } }));
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /El sistema sugirió DRINK \(beber\)/);
  assert.match(summary, /no indica si la hiciste correctamente/);
  assert.doesNotMatch(summary, /85%/);
});

test("shows plain Groq advice in the main result", async () => {
  const app = harness();
  await app.connect();
  const message = finalResult({ recognition: {
    status: "experimental", target_gloss: "drink", target_probability: 0.85,
    top_k: [{ gloss: "drink", score: 0.85 }],
  } });
  message.feedback_source = "groq";
  message.feedback_status = "ok";
  message.feedback_summary = "La cámara registró tu seña para este intento.";
  message.feedback_recommendations = ["Puedes practicar de nuevo cuando quieras."];
  await app.receive("evaluation.final", message);
  const summary = app.elements.get("summary").textContent;
  assert.match(summary, /Comentario: La cámara registró tu seña/);
  assert.match(summary, /Qué puedes hacer: Puedes practicar de nuevo/);
  assert.doesNotMatch(summary, /Groq|clasificador|glosa|fotogramas/);
});

test("explains insufficient capture and inference errors separately", async () => {
  const app = harness();
  await app.connect();
  await app.receive("evaluation.final", finalResult({
    quality: { window_frames: 1 },
    recognition: { status: "insufficient_data", target_probability: null, top_k: [] },
  }));
  assert.match(app.elements.get("summary").textContent, /cámara no captó suficientes datos/);
  assert.match(app.elements.get("summary").textContent, /cámara se mueva con fluidez/);
  await app.receive("evaluation.final", finalResult({
    quality: { pose_coverage_pct: 45, pose_longest_missing_gap_seconds: 0.8 },
    recognition: { status: "insufficient_data", target_probability: null, top_k: [] },
  }));
  assert.match(app.elements.get("summary").textContent, /Muestra los hombros y el torso/);
  await app.receive("evaluation.final", finalResult({
    recognition: { status: "error", target_probability: null, top_k: [] },
  }));
  assert.match(app.elements.get("summary").textContent, /problema al procesar/);
  assert.doesNotMatch(app.elements.get("summary").textContent, /otra palabra/);
});

test("keeps the old-backend warning visible", async () => {
  const app = harness();
  await app.connect();
  await app.receive("evaluation.final", { quality: {}, recognition: {} });
  assert.match(app.elements.get("status").textContent, /versión anterior/);
  assert.doesNotMatch(app.elements.get("status").textContent, /Resultado listo/);
});
