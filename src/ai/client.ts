import { chooseFallbackDecision } from "./fallback";
import { parseAiDecision } from "./prompt";
import type { AiActionKind, AiDecisionResult, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";
import type { GameState } from "../game/types";

interface RequestAiActionInput {
  state: GameState;
  playerId: string;
  actionKind: AiActionKind;
  legalActions: LegalAction[];
  tableTalk?: PublicTalkEntry[];
  reasoningEffort: ReasoningEffort;
  language: TableLanguage;
  model: string;
}

export async function requestAiAction(input: RequestAiActionInput): Promise<AiDecisionResult> {
  const fallback = chooseFallbackDecision(input.state, input.playerId, input.actionKind, input.language);
  try {
    const response = await fetch("/api/ai-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(`AI endpoint returned ${response.status}`);
    }

    const raw = await response.text();
    const decision = parseAiDecision(raw, input.legalActions, fallback);
    return {
      ...decision,
      source: readEndpointSource(raw) === "fallback" ? "fallback" : decision.source
    };
  } catch {
    return { ...fallback, source: "fallback" };
  }
}

function readEndpointSource(raw: string): "model" | "fallback" | null {
  try {
    const parsed = JSON.parse(raw) as { source?: unknown };
    return parsed.source === "model" || parsed.source === "fallback" ? parsed.source : null;
  } catch {
    return null;
  }
}
