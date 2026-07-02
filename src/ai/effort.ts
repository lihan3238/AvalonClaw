import type { AiActionKind, ReasoningEffort } from "./types";

// Short or low-information actions never benefit from long reasoning, so cap
// them regardless of the table-level requested effort. Strategic actions cap
// at high to avoid spending the fixed four-minute window on xhigh requests
// that historically fall back instead of completing usefully.
export function effectiveReasoningEffortForAction(actionKind: AiActionKind, requested: ReasoningEffort): ReasoningEffort {
  if (actionKind === "quest") {
    return "low";
  }
  if ((actionKind === "speak" || actionKind === "vote") && (requested === "high" || requested === "xhigh")) {
    return "medium";
  }
  if ((actionKind === "proposeTeam" || actionKind === "assassinate") && requested === "xhigh") {
    return "high";
  }
  return requested;
}

// Per-attempt upstream window. Keep this aligned with the browser-side ceiling
// so every AI request layer uses the same four-minute timeout.
export function upstreamTimeoutMsForEffort(effort: ReasoningEffort): number {
  if (effort === "xhigh") {
    return 240_000;
  }
  if (effort === "high") {
    return 240_000;
  }
  if (effort === "medium") {
    return 240_000;
  }
  return 240_000;
}

const CLIENT_TIMEOUT_BUFFER_MS = 0;

// Browser-side ceiling for one /api/ai-action request.
export function clientAiTimeoutMsFor(actionKind: AiActionKind, requested: ReasoningEffort): number {
  return upstreamTimeoutMsForEffort(effectiveReasoningEffortForAction(actionKind, requested)) + CLIENT_TIMEOUT_BUFFER_MS;
}
