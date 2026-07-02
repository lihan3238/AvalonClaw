import type { QuestCard } from "../game/types";

export type AiActionKind = "proposeTeam" | "speak" | "vote" | "quest" | "assassinate";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type TableLanguage = "en" | "zh";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface AiPromptMetrics {
  messageCount: number;
  systemChars: number;
  userChars: number;
  totalChars: number;
}

export interface AiApiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
}

export interface AiApiTiming {
  durationMs: number;
  attempts: number;
}

export interface AiRuntimeConfig {
  baseURL: string;
  apiKey: string;
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
  | { type: "speak" }
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

export type AiFallbackDetail =
  | "no-json-object"
  | "malformed-json"
  | "invalid-decision-shape"
  | "illegal-action";

export type AiSpeechRepairReason =
  | "missing-speech"
  | "nested-speech"
  | "forced-legal-action"
  | "unsafe-role-word"
  | "secret-intent-leak"
  | "schema-echo"
  | "overlong-speech"
  | "quest-card-speech";

export interface AiDecisionResult extends AiDecision {
  source: "model" | "fallback" | "local";
  fallbackReason?: AiFallbackReason;
  fallbackDetail?: AiFallbackDetail;
  fallbackDiagnostic?: string;
  speechRepairReason?: AiSpeechRepairReason;
  rawModelContent?: string;
  promptMetrics?: AiPromptMetrics;
  apiUsage?: AiApiUsage;
  apiTiming?: AiApiTiming;
}
