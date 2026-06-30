import { chooseFallbackDecision } from "./fallback";
import { parseAiDecision } from "./prompt";
import type { AiActionKind, AiDecisionResult, AiFallbackDetail, AiFallbackReason, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";
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
    const endpointSource = readEndpointSource(raw);
    const endpointReason = readEndpointFallbackReason(raw);
    const endpointDetail = readEndpointFallbackDetail(raw);
    const decision = parseAiDecision(raw, input.legalActions, fallback);
    if (endpointSource === "fallback") {
      return {
        ...decision,
        source: "fallback",
        fallbackReason: endpointReason ?? decision.fallbackReason ?? "api-error",
        ...(endpointDetail ?? decision.fallbackDetail ? { fallbackDetail: endpointDetail ?? decision.fallbackDetail } : {})
      };
    }
    if (decision.source === "fallback" && decision.fallbackReason === "illegal-action" && endpointSource === "model") {
      return { ...decision, fallbackReason: "client-illegal-action" };
    }

    return decision;
  } catch {
    return { ...fallback, source: "fallback", fallbackReason: "network-error" };
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

function readEndpointFallbackReason(raw: string): AiFallbackReason | null {
  try {
    const parsed = JSON.parse(raw) as { fallbackReason?: unknown };
    return isAiFallbackReason(parsed.fallbackReason) ? parsed.fallbackReason : null;
  } catch {
    return null;
  }
}

function readEndpointFallbackDetail(raw: string): AiFallbackDetail | null {
  try {
    const parsed = JSON.parse(raw) as { fallbackDetail?: unknown };
    return isAiFallbackDetail(parsed.fallbackDetail) ? parsed.fallbackDetail : null;
  } catch {
    return null;
  }
}

function isAiFallbackReason(value: unknown): value is AiFallbackReason {
  return value === "missing-config"
    || value === "api-error"
    || value === "api-timeout"
    || value === "api-http-error"
    || value === "api-empty-response"
    || value === "api-invalid-response"
    || value === "invalid-json"
    || value === "illegal-action"
    || value === "client-illegal-action"
    || value === "network-error";
}

function isAiFallbackDetail(value: unknown): value is AiFallbackDetail {
  return value === "no-json-object"
    || value === "malformed-json"
    || value === "invalid-decision-shape"
    || value === "illegal-action";
}
