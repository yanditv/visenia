export const VISENA_PROTOCOL_VERSION = "1.0" as const;
export type EvaluationStatus = "ok" | "partial" | "insufficient_data" | "error";
export type EvaluationParameter = "handshape" | "orientation" | "location" | "movement" | "non_manual";

export interface CaptureInfo {
  width: number;
  height: number;
  fps: number;
  frame_encoding: "jpeg";
}

export interface SessionStartMessage {
  type: "session.start";
  protocol_version: "1.0";
  reference_id: string;
  demo_mode: boolean;
  capture: CaptureInfo;
}

export type ControlType = "evaluation.begin" | "evaluation.end" | "evaluation.reset" | "session.stop" | "session.pong";
export interface ControlMessage {
  type: ControlType;
  protocol_version: "1.0";
}

export interface RegionQuality {
  coverage_pct: number;
  valid_frames: number;
  total_frames: number;
  longest_missing_gap_seconds: number;
}

export interface QualityMetrics {
  window_frames: number;
  left_hand_coverage_pct: number;
  right_hand_coverage_pct: number;
  pose_coverage_pct: number;
  face_coverage_pct: number;
  left_hand_longest_missing_gap_seconds: number;
  right_hand_longest_missing_gap_seconds: number;
  pose_longest_missing_gap_seconds: number;
  face_longest_missing_gap_seconds: number;
  frames_received: number;
  frames_processed: number;
  frames_dropped: number;
  processing_latency_ms: number;
  evaluation_latency_ms: number;
}

export interface ParameterResult {
  status: EvaluationStatus;
  distance: number | null;
  demo_score: number | null;
  reference_quality?: RegionQuality;
  candidate_quality?: RegionQuality;
  hands?: Record<"left_hand" | "right_hand", ParameterResult>;
}

export interface RecognitionResult {
  status: "experimental";
  model: "WLASL";
  top_k: Array<{ label: string; score: number }>;
  warning: string;
}

export interface SessionReadyMessage {
  type: "session.ready";
  protocol_version: "1.0";
  session_id: string;
  reference_id: string;
  status: "ready";
}

export interface EvaluationResultBase {
  protocol_version: "1.0";
  session_id: string;
  reference_id: string;
  frame_sequence: number | null;
  timestamp_ms: number | null;
  quality: QualityMetrics;
  parameters: Record<EvaluationParameter, ParameterResult>;
  overall: { status: EvaluationStatus; demo_score: number | null };
  recognition: RecognitionResult;
  warnings: string[];
}

export interface EvaluationPartialMessage extends EvaluationResultBase {
  type: "evaluation.partial";
  status: "partial";
}

export interface EvaluationFinalMessage extends EvaluationResultBase {
  type: "evaluation.final";
  status: "complete";
}

export interface VisenaErrorMessage {
  type: "error";
  protocol_version: "1.0";
  session_id?: string;
  code: "INVALID_MESSAGE" | "INVALID_FRAME" | "INVALID_TIMESTAMP" | "REFERENCE_NOT_FOUND" |
    "SESSION_NOT_READY" | "EVALUATION_NOT_STARTED" | "BUFFER_OVERFLOW" |
    "PROCESSING_ERROR" | "INFERENCE_ERROR" | "INTERNAL_ERROR";
  message: string;
  recoverable: boolean;
}

export interface SessionPingMessage { type: "session.ping"; protocol_version: "1.0"; session_id: string }
export interface SessionStoppedMessage { type: "session.stopped"; protocol_version: "1.0"; session_id: string }
export interface EvaluationStartedMessage { type: "evaluation.started"; protocol_version: "1.0"; session_id: string }
export interface EvaluationResetMessage { type: "evaluation.reset"; protocol_version: "1.0"; session_id: string }

export type VisenaMessage = SessionReadyMessage | EvaluationPartialMessage | EvaluationFinalMessage |
  VisenaErrorMessage | SessionPingMessage | SessionStoppedMessage |
  EvaluationStartedMessage | EvaluationResetMessage;
