import type { QualityMetrics } from "./visena-realtime.types";

export const ASL_PROTOCOL_VERSION = "2.0" as const;

export interface ASLSessionStart {
  type: "session.start";
  protocol_version: "2.0";
  target_gloss: string;
  practice_hand?: "left" | "right" | "either";
  capture: { width: number; height: number; fps: number; frame_encoding: "jpeg" };
}

export interface ASLRecognition {
  status: "pending" | "experimental" | "insufficient_data" | "error";
  model: "OpenHands/BERT-WLASL2000";
  target_gloss: string;
  target_probability: number | null;
  top_k: Array<{ class_id: number; gloss: string; score: number }>;
  input_window?: { frames: number; start_ms: number; end_ms: number; trimmed: boolean; focus_hand?: "left" | "right" | null } | null;
}

export interface ASLResult {
  type: "evaluation.partial" | "evaluation.final";
  protocol_version: "2.0";
  session_id: string;
  target_gloss: string;
  frame_sequence: number | null;
  timestamp_ms: number | null;
  status: "partial" | "complete";
  quality: QualityMetrics;
  recognition: ASLRecognition;
  execution_score: null;
  execution_score_status: "awaiting_validation";
  observations?: {
    hand_to_mouth: boolean;
    hands_to_mouth: { left: boolean; right: boolean };
    practice_hand: "left" | "right" | "either";
    practice_hand_status: "matching_hand" | "opposite_hand" | "observed" | "not_observed";
  } | null;
  feedback: string[];
  feedback_source: "groq" | "rules";
  feedback_status: "ok" | "unavailable" | "error" | "not_requested";
  feedback_model?: string | null;
  feedback_summary: string;
  feedback_recommendations?: string[];
  feedback_http_status: number | null;
  feedback_diagnostic?: string | null;
  services?: {
    mediapipe: "used" | "not_used";
    asl_model: "used" | "not_used" | "error";
    groq: "used" | "not_used" | "unavailable" | "error";
  };
  warnings: string[];
}

export interface ASLError {
  type: "error";
  protocol_version: "2.0";
  session_id: string | null;
  code: string;
  message: string;
  recoverable: boolean;
}

export type ASLServerMessage = ASLResult | ASLError |
  { type: "session.ready"; protocol_version: "2.0"; session_id: string; target_gloss: string; status: "ready"; server_build: string } |
  { type: "evaluation.started" | "evaluation.reset" | "session.stopped" | "session.ping";
    protocol_version: "2.0"; session_id: string };
