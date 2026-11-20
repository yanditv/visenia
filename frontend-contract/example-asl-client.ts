import { ASL_PROTOCOL_VERSION, type ASLServerMessage, type ASLSessionStart } from "./visena-asl.types";

/** Browser-only prototype. Display the teaching video separately before calling begin(). */
export class ASLPrototypeClient {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: number | null = null;
  private active = false;
  private encoding = false;
  private origin = performance.now();
  private sequence = 0;
  private timestamp = 0;

  constructor(private readonly onMessage: (message: ASLServerMessage) => void) {}

  async connect(targetGloss: string): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30, max: 30 } }, audio: false,
    });
    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    this.origin = performance.now();
    this.sequence = this.timestamp = 0;
    const socket = new WebSocket("ws://127.0.0.1:8000/ws/v2/visena/recognize");
    this.socket = socket;
    let ready: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    const readyPromise = new Promise<void>((resolve, reject) => {
      ready = resolve;
      rejectReady = reject;
    });
    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ASLServerMessage;
      this.onMessage(message);
      if (message.type === "session.ready") ready?.();
      if (message.type === "session.ping") this.control("session.pong");
      if (message.type === "error" && !message.recoverable) rejectReady?.(new Error(message.message));
      if (message.type === "evaluation.final") this.active = false;
    };
    socket.onclose = () => rejectReady?.(new Error("WebSocket closed"));
    socket.onerror = () => rejectReady?.(new Error("WebSocket connection failed"));
    socket.onopen = () => {
      const start: ASLSessionStart = {
        type: "session.start", protocol_version: ASL_PROTOCOL_VERSION,
        target_gloss: targetGloss,
        capture: { width: canvas.width, height: canvas.height, fps: 30, frame_encoding: "jpeg" },
      };
      socket.send(JSON.stringify(start));
    };
    await readyPromise;
    rejectReady = null;
    this.timer = window.setInterval(async () => {
      if (!this.active || this.encoding || !this.video || socket.readyState !== WebSocket.OPEN) return;
      this.encoding = true;
      try {
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
        if (!blob || !this.active) return;
        const jpeg = await blob.arrayBuffer();
        if (!this.active) return;
        this.timestamp = Math.max(this.timestamp + 1, Math.round(performance.now() - this.origin));
        const packet = new ArrayBuffer(12 + jpeg.byteLength);
        const view = new DataView(packet);
        view.setBigUint64(0, BigInt(this.timestamp), true);
        view.setUint32(8, ++this.sequence, true);
        new Uint8Array(packet, 12).set(new Uint8Array(jpeg));
        socket.send(packet);
      } finally {
        this.encoding = false;
      }
    }, 1000 / 30);
    return this.stream;
  }

  begin(): void { this.control("evaluation.begin"); this.active = true; }
  end(): void { this.active = false; this.control("evaluation.end"); }
  reset(): void { this.active = false; this.control("evaluation.reset"); }
  close(): void {
    this.active = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.control("session.stop");
    this.socket?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.socket = null;
    this.stream = null;
    this.video = null;
  }

  private control(type: "evaluation.begin" | "evaluation.end" | "evaluation.reset" | "session.stop" | "session.pong"): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, protocol_version: ASL_PROTOCOL_VERSION }));
    }
  }
}
