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

export interface AiDecisionResult extends AiDecision {
  source: "model" | "fallback";
}
