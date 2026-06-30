import type { QuestCard } from "../game/types";

export type AiActionKind = "proposeTeam" | "vote" | "quest" | "assassinate";
export type ReasoningEffort = "low" | "medium" | "high";
export type TableLanguage = "en" | "zh";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface Persona {
  caution: number;
  aggression: number;
  talkativeness: number;
  trustBias: number;
  deceptionComfort: number;
}

export interface PublicTalkEntry {
  id: number;
  speakerId: string;
  speakerName: string;
  text: string;
}

export type LegalAction =
  | { type: "proposeTeam"; teamIds: string[] }
  | { type: "vote"; approve: boolean }
  | { type: "quest"; card: QuestCard }
  | { type: "assassinate"; targetId: string };

export interface AiDecision {
  speech: string;
  action: LegalAction;
}

export type AiFallbackReason =
  | "missing-config"
  | "api-error"
  | "api-timeout"
  | "api-http-error"
  | "api-empty-response"
  | "api-invalid-response"
  | "invalid-json"
  | "illegal-action"
  | "client-illegal-action"
  | "network-error";

export type AiSpeechRepairReason =
  | "missing-speech"
  | "unsafe-role-word"
  | "schema-echo"
  | "low-information"
  | "action-mismatch"
  | "quest-card-speech";

export interface AiDecisionResult extends AiDecision {
  source: "model" | "fallback";
  fallbackReason?: AiFallbackReason;
  speechRepairReason?: AiSpeechRepairReason;
}
