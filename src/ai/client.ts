import { chooseFallbackDecision } from "./fallback";
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
  try {
    const response = await fetch("/api/ai-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(`AI endpoint returned ${response.status}`);
    }

    return (await response.json()) as AiDecisionResult;
  } catch {
    return { ...chooseFallbackDecision(input.state, input.playerId, input.actionKind, input.language), source: "fallback" };
  }
}
