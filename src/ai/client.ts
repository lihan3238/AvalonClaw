import { clientAiTimeoutMsFor } from "./effort";
import { chooseFallbackDecision } from "./fallback";
import { parseAiDecision } from "./prompt";
import type { AiActionKind, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiRuntimeConfig, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";
import type { GameState } from "../game/types";

interface RequestAiActionInput {
  sessionId?: string;
  state: GameState;
  playerId: string;
  actionKind: AiActionKind;
  legalActions: LegalAction[];
  tableTalk?: PublicTalkEntry[];
  reasoningEffort: ReasoningEffort;
  language: TableLanguage;
  model: string;
  aiConfig: AiRuntimeConfig;
  timeoutMs?: number;
}

// Hard client-side ceiling so a hung connection can never leave a seat "thinking" forever.
// The per-action default from clientAiTimeoutMsFor stays above the server's
// effort-scaled single-attempt window; this constant is only the legacy export
// used by tests and callers that pass an explicit timeoutMs.
export const CLIENT_AI_REQUEST_TIMEOUT_MS = 180_000;

export async function requestAiAction(input: RequestAiActionInput): Promise<AiDecisionResult> {
  const fallback = chooseFallbackDecision(input.state, input.playerId, input.actionKind, input.language);
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? clientAiTimeoutMsFor(input.actionKind, input.reasoningEffort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/ai-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal
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
    if (endpointSource === "local") {
      return {
        speech: decision.speech,
        action: decision.action,
        source: "local"
      };
    }
    if (decision.source === "fallback" && decision.fallbackReason === "illegal-action" && endpointSource === "model") {
      return { ...decision, fallbackReason: "client-illegal-action" };
    }

    return decision;
  } catch (error) {
    return { ...fallback, source: "fallback", fallbackReason: isAbortError(error) ? "api-timeout" : "network-error" };
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

function readEndpointSource(raw: string): "model" | "fallback" | "local" | null {
  try {
    const parsed = JSON.parse(raw) as { source?: unknown };
    return parsed.source === "model" || parsed.source === "fallback" || parsed.source === "local" ? parsed.source : null;
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
