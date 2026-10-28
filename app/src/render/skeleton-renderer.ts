/**
 * Renderizador de Esqueleto 2D en Canvas - Viseña (RF-02)
 * Dibuja los puntos clave (landmarks) y conexiones óseas de MediaPipe Holistic:
 * - Pose superior (torso, hombros, brazos)
 * - Manos (21 landmarks y falanges) con unión a muñecas
 * - Contorno facial (cejas, ojos, labios) para expresión prosoponémica
 */

export interface LandmarkPoint {
  x: number; // Normalizado 0.0 a 1.0 (o metros en pose_world)
  y: number; // Normalizado 0.0 a 1.0 (o metros en pose_world)
  z?: number;
  visibility?: number;
}

export interface HolisticFrameLandmarks {
  pose?: LandmarkPoint[];
  poseWorld?: LandmarkPoint[];
  leftHand?: LandmarkPoint[];
  rightHand?: LandmarkPoint[];
  face?: LandmarkPoint[];
  blendshapes?: Record<string, number>;
  vrmPoseOverride?: Record<string, [number, number, number, number]>;
}

// Conexiones de mano estándar de MediaPipe (21 puntos)
export const HAND_CONNECTIONS: [number, number][] = [
  // Pulgar
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Índice
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Medio
  [5, 9], [9, 10], [10, 11], [11, 12],
  // Anular
  [9, 13], [13, 14], [14, 15], [15, 16],
  // Meñique
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

// Conexiones de torso / pose clave para lengua de señas
export const POSE_UPPER_CONNECTIONS: [number, number][] = [
  // Hombros y pecho
  [11, 12],
  // Brazo izquierdo: Hombro -> Codo -> Muñeca
  [11, 13], [13, 15],
  // Brazo derecho: Hombro -> Codo -> Muñeca
  [12, 14], [14, 16],
  // Cuello / Cabeza a hombros
  [0, 11], [0, 12]
];

export class SkeletonRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo obtener el contexto 2D del Canvas');
    }
    this.ctx = context;
  }

  public resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public render(landmarks: HolisticFrameLandmarks): void {
    this.clear();
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Renderizar Rostro (Contorno y Expresión)
    if (landmarks.face && landmarks.face.length > 0) {
      this.drawPoints(landmarks.face, '#f472b6', 2.5, w, h);
    }

    // 2. Renderizar Pose (Torso y Brazos)
    if (landmarks.pose && landmarks.pose.length > 0) {
      this.drawConnections(landmarks.pose, POSE_UPPER_CONNECTIONS, '#38bdf8', 3, w, h);
      this.drawPoints(landmarks.pose, '#0284c7', 5, w, h, [0, 11, 12, 13, 14, 15, 16]);

      // Conexión dinámica antebrazo a carpo de mano izquierda
      if (landmarks.leftHand && landmarks.leftHand.length === 21 && landmarks.pose[15]) {
        this.drawDirectLine(landmarks.pose[15], landmarks.leftHand[0], '#38bdf8', 2.5, w, h);
      }

      // Conexión dinámica antebrazo a carpo de mano derecha
      if (landmarks.rightHand && landmarks.rightHand.length === 21 && landmarks.pose[16]) {
        this.drawDirectLine(landmarks.pose[16], landmarks.rightHand[0], '#38bdf8', 2.5, w, h);
      }
    }

    // 3. Renderizar Mano Izquierda
    if (landmarks.leftHand && landmarks.leftHand.length === 21) {
      this.drawConnections(landmarks.leftHand, HAND_CONNECTIONS, '#4ade80', 2, w, h);
      this.drawPoints(landmarks.leftHand, '#16a34a', 3.5, w, h);
    }

    // 4. Renderizar Mano Derecha
    if (landmarks.rightHand && landmarks.rightHand.length === 21) {
      this.drawConnections(landmarks.rightHand, HAND_CONNECTIONS, '#4ade80', 2, w, h);
      this.drawPoints(landmarks.rightHand, '#16a34a', 3.5, w, h);
    }
  }

  private drawDirectLine(
    p1: LandmarkPoint,
    p2: LandmarkPoint,
    color: string,
    lineWidth: number,
    w: number,
    h: number
  ): void {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x * w, p1.y * h);
    this.ctx.lineTo(p2.x * w, p2.y * h);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawConnections(
    points: LandmarkPoint[],
    connections: [number, number][],
    color: string,
    lineWidth: number,
    w: number,
    h: number
  ): void {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';

    for (const [i, j] of connections) {
      const p1 = points[i];
      const p2 = points[j];
      if (p1 && p2 && (p1.visibility === undefined || p1.visibility > 0.4) && (p2.visibility === undefined || p2.visibility > 0.4)) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x * w, p1.y * h);
        this.ctx.lineTo(p2.x * w, p2.y * h);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  private drawPoints(
    points: LandmarkPoint[],
    color: string,
    radius: number,
    w: number,
    h: number,
    indices?: number[]
  ): void {
    this.ctx.save();
    this.ctx.fillStyle = color;

    const toDraw = indices ? indices.map((i) => ({ pt: points[i], idx: i })) : points.map((pt, idx) => ({ pt, idx }));

    for (const item of toDraw) {
      const p = item.pt;
      if (p && (p.visibility === undefined || p.visibility > 0.4)) {
        this.ctx.beginPath();
        this.ctx.arc(p.x * w, p.y * h, radius, 0, 2 * Math.PI);
        this.ctx.fill();
      }
    }
    this.ctx.restore();
  }

  public generateSyntheticPose(timestamp: number): HolisticFrameLandmarks {
    const t = timestamp / 1000;
    const wave = Math.sin(t * 3) * 0.08;

    const pose: LandmarkPoint[] = [
      { x: 0.5, y: 0.25, visibility: 0.9 }, // 0: nariz
      ...Array(10).fill({ x: 0.5, y: 0.25, visibility: 0.1 }),
      { x: 0.38, y: 0.42, visibility: 0.95 }, // 11: hombro izq
      { x: 0.62, y: 0.42, visibility: 0.95 }, // 12: hombro der
      { x: 0.32, y: 0.60, visibility: 0.95 }, // 13: codo izq
      { x: 0.68 + wave * 0.5, y: 0.55 - wave, visibility: 0.95 }, // 14: codo der
      { x: 0.30, y: 0.78, visibility: 0.95 }, // 15: muñeca izq
      { x: 0.65 + wave, y: 0.35 + wave, visibility: 0.95 }  // 16: muñeca der
    ];

    const poseWorld: LandmarkPoint[] = pose.map((pt) => ({
      x: (pt.x - 0.5) * 1.5,
      y: (0.5 - pt.y) * 1.5,
      z: 0.0,
      visibility: pt.visibility
    }));

    const rightHand: LandmarkPoint[] = Array.from({ length: 21 }, (_, idx) => {
      const offsetX = 0.65 + wave + (idx % 5) * 0.015;
      const offsetY = 0.35 + wave + Math.floor(idx / 5) * 0.02;
      return { x: offsetX, y: offsetY, visibility: 0.95 };
    });

    const face: LandmarkPoint[] = [
      { x: 0.45, y: 0.20 }, { x: 0.55, y: 0.20 }, // cejas
      { x: 0.46, y: 0.24 }, { x: 0.54, y: 0.24 }, // ojos
      { x: 0.50, y: 0.28 }, // nariz
      { x: 0.47, y: 0.32 }, { x: 0.53, y: 0.32 }  // boca
    ];

    return { pose, poseWorld, rightHand, face };
  }
}
