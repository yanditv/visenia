import {
  VISENA_PROTOCOL_VERSION,
  type ControlType,
  type SessionStartMessage,
  type VisenaMessage,
} from "./visena-realtime.types";

/** Minimal browser client. Supply UI callbacks; no frontend framework is required. */
export class VisenaRealtimeClient {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private sequence = 0;
  private origin = performance.now();
  private lastTimestamp = 0;
  private encoding = false;
  private capturing = false;

  constructor(
    private readonly url: string,
    private readonly onPartial: (message: Extract<VisenaMessage, { type: "evaluation.partial" }>) => void,
    private readonly onFinal: (message: Extract<VisenaMessage, { type: "evaluation.final" }>) => void,
    private readonly onError: (message: Extract<VisenaMessage, { type: "error" }>) => void,
  ) {}

  async connect(referenceId: string, demoMode = false, fps = 30): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { frameRate: fps }, audio: false });
    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    const capture = {
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      fps,
      frame_encoding: "jpeg" as const,
    };
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    let markReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      rejectReady = reject;
    });
    socket.onclose = () => rejectReady?.(new Error("WebSocket closed during handshake"));
    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as VisenaMessage;
      if (message.protocol_version !== VISENA_PROTOCOL_VERSION) return;
      switch (message.type) {
        case "session.ready":
          markReady?.();
          break;
        case "evaluation.partial": this.onPartial(message); break;
        case "evaluation.final": this.capturing = false; this.onFinal(message); break;
        case "error":
          this.onError(message);
          if (!message.recoverable) rejectReady?.(new Error(message.message));
          break;
        case "session.ping": this.control("session.pong"); break;
      }
    };
    await new Promise<void>((resolve, reject) => {
      socket.onerror = () => reject(new Error("WebSocket connection failed"));
      socket.onopen = () => {
        const start: SessionStartMessage = {
          type: "session.start", protocol_version: VISENA_PROTOCOL_VERSION,
          reference_id: referenceId, demo_mode: demoMode, capture,
        };
        socket.send(JSON.stringify(start));
        resolve();
      };
    });
    await ready;
    rejectReady = null;
    const canvas = document.createElement("canvas");
    canvas.width = capture.width;
    canvas.height = capture.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    this.timer = window.setInterval(async () => {
      if (!this.capturing || this.encoding || socket.readyState !== WebSocket.OPEN || !this.video) return;
      this.encoding = true;
      try {
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
        if (!blob) return;
        const jpeg = await blob.arrayBuffer();
        const timestamp = Math.max(this.lastTimestamp + 1, Math.round(performance.now() - this.origin));
        this.lastTimestamp = timestamp;
        const packet = new ArrayBuffer(12 + jpeg.byteLength);
        const view = new DataView(packet);
        view.setBigUint64(0, BigInt(timestamp), true);
        view.setUint32(8, ++this.sequence, true);
        new Uint8Array(packet, 12).set(new Uint8Array(jpeg));
        socket.send(packet);
      } finally {
        this.encoding = false;
      }
    }, 1000 / fps);
  }

  begin(): void { this.control("evaluation.begin"); this.capturing = true; }
  end(): void { this.capturing = false; this.control("evaluation.end"); }
  reset(): void { this.capturing = false; this.control("evaluation.reset"); }

  close(): void {
    this.capturing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.socket?.readyState === WebSocket.OPEN) this.control("session.stop");
    this.socket?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.video = null;
    this.stream = null;
    this.socket = null;
  }

  private control(type: ControlType): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, protocol_version: VISENA_PROTOCOL_VERSION }));
    }
  }
}
