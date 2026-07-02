import type { AiActionKind, ReasoningEffort } from "./types";

// Short or low-information actions never benefit from long reasoning, so cap
// them regardless of the table-level requested effort. Proposals cap at high:
// real xhigh traces exceed even a 150s window and always end in fallback,
// while high-effort proposals finish inside the 90s window.
export function effectiveReasoningEffortForAction(actionKind: AiActionKind, requested: ReasoningEffort): ReasoningEffort {
  if (actionKind === "quest") {
    return "low";
  }
  if ((actionKind === "speak" || actionKind === "vote") && (requested === "high" || requested === "xhigh")) {
    return "medium";
  }
  if (actionKind === "proposeTeam" && requested === "xhigh") {
    return "high";
  }
  return requested;
}

// Per-attempt upstream window. Reasoning models legitimately take minutes at
// xhigh effort, so a flat 45s window aborts healthy generations and burns the
// whole retry budget on repeats that can never finish (observed as ~136s
// proposal stalls that always end in local fallback).
export function upstreamTimeoutMsForEffort(effort: ReasoningEffort): number {
  if (effort === "xhigh") {
    return 150_000;
  }
  if (effort === "high") {
    return 90_000;
  }
  if (effort === "medium") {
    return 60_000;
  }
  return 45_000;
}

const CLIENT_TIMEOUT_BUFFER_MS = 30_000;

// Browser-side ceiling for one /api/ai-action request: the server's worst-case
// single-attempt window for this action, plus queue/transfer headroom.
export function clientAiTimeoutMsFor(actionKind: AiActionKind, requested: ReasoningEffort): number {
  return upstreamTimeoutMsForEffort(effectiveReasoningEffortForAction(actionKind, requested)) + CLIENT_TIMEOUT_BUFFER_MS;
}
