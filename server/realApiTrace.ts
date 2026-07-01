import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AiActionKind, AiApiUsage, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiPromptMetrics, AiSpeechRepairReason, ReasoningEffort } from "../src/ai/types";

export type RealApiTraceModelTier = "strong" | "weak" | "uniform";

export interface RealApiTraceEntry {
  actionKind: AiActionKind;
  source: AiDecisionResult["source"];
  fallbackReason?: AiFallbackReason;
  fallbackDetail?: AiFallbackDetail;
  speechRepairReason?: AiSpeechRepairReason;
  modelTier: RealApiTraceModelTier;
  requestedReasoningEffort?: ReasoningEffort;
  reasoningEffort?: ReasoningEffort;
  promptMetrics?: AiPromptMetrics;
  apiUsage?: AiApiUsage;
}

export interface RealApiNumberSummary {
  count: number;
  min: number;
  max: number;
  total: number;
  average: number;
}

export interface RealApiUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  reasoningTokens: number;
}

export interface RealApiTraceDiagnostics {
  steps: number;
  modelActions: number;
  localActions: number;
  fallbackCount: number;
  fallbacksByReason: Partial<Record<AiFallbackReason, number>>;
  fallbacksByDetail: Partial<Record<AiFallbackDetail, number>>;
  fallbacksByActionKind: Partial<Record<AiActionKind, number>>;
  fallbacksByModelTier: Partial<Record<RealApiTraceModelTier, number>>;
  fallbacksByReasoningEffort: Partial<Record<ReasoningEffort, number>>;
  fallbacksByRequestedReasoningEffort: Partial<Record<ReasoningEffort, number>>;
  promptChars?: RealApiNumberSummary;
  promptCharsByActionKind: Partial<Record<AiActionKind, RealApiNumberSummary>>;
  apiUsageTotals: RealApiUsageTotals;
  localByActionKind: Partial<Record<AiActionKind, number>>;
  speechRepairsByReason: Partial<Record<AiSpeechRepairReason, number>>;
}

export function summarizeRealApiTrace(trace: RealApiTraceEntry[]): RealApiTraceDiagnostics {
  const promptChars = createNumberAccumulator();
  const promptCharsByActionKind: Partial<Record<AiActionKind, NumberAccumulator>> = {};
  const diagnostics: RealApiTraceDiagnostics = {
    steps: trace.length,
    modelActions: 0,
    localActions: 0,
    fallbackCount: 0,
    fallbacksByReason: {},
    fallbacksByDetail: {},
    fallbacksByActionKind: {},
    fallbacksByModelTier: {},
    fallbacksByReasoningEffort: {},
    fallbacksByRequestedReasoningEffort: {},
    promptCharsByActionKind: {},
    apiUsageTotals: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
      reasoningTokens: 0
    },
    localByActionKind: {},
    speechRepairsByReason: {}
  };

  for (const entry of trace) {
    if (entry.promptMetrics) {
      addNumber(promptChars, entry.promptMetrics.totalChars);
      const actionPromptChars = promptCharsByActionKind[entry.actionKind] ?? createNumberAccumulator();
      addNumber(actionPromptChars, entry.promptMetrics.totalChars);
      promptCharsByActionKind[entry.actionKind] = actionPromptChars;
    }
    if (entry.apiUsage) {
      addUsage(diagnostics.apiUsageTotals, entry.apiUsage);
    }

    if (entry.source === "fallback") {
      diagnostics.fallbackCount += 1;
      increment(diagnostics.fallbacksByActionKind, entry.actionKind);
      increment(diagnostics.fallbacksByModelTier, entry.modelTier);
      if (entry.fallbackReason) {
        increment(diagnostics.fallbacksByReason, entry.fallbackReason);
      }
      if (entry.fallbackDetail) {
        increment(diagnostics.fallbacksByDetail, entry.fallbackDetail);
      }
      if (entry.reasoningEffort) {
        increment(diagnostics.fallbacksByReasoningEffort, entry.reasoningEffort);
      }
      if (entry.requestedReasoningEffort) {
        increment(diagnostics.fallbacksByRequestedReasoningEffort, entry.requestedReasoningEffort);
      }
    } else if (entry.source === "local") {
      diagnostics.localActions += 1;
      increment(diagnostics.localByActionKind, entry.actionKind);
    } else {
      diagnostics.modelActions += 1;
    }

    if (entry.speechRepairReason) {
      increment(diagnostics.speechRepairsByReason, entry.speechRepairReason);
    }
  }

  if (promptChars.count) {
    diagnostics.promptChars = summarizeNumbers(promptChars);
  }
  for (const [actionKind, accumulator] of Object.entries(promptCharsByActionKind) as Array<[AiActionKind, NumberAccumulator]>) {
    diagnostics.promptCharsByActionKind[actionKind] = summarizeNumbers(accumulator);
  }

  return diagnostics;
}

export function appendRealApiResultJsonl(outputPath: string, result: unknown): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
}

function increment<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

interface NumberAccumulator {
  count: number;
  min: number;
  max: number;
  total: number;
}

function createNumberAccumulator(): NumberAccumulator {
  return {
    count: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0
  };
}

function addNumber(accumulator: NumberAccumulator, value: number): void {
  accumulator.count += 1;
  accumulator.min = Math.min(accumulator.min, value);
  accumulator.max = Math.max(accumulator.max, value);
  accumulator.total += value;
}

function summarizeNumbers(accumulator: NumberAccumulator): RealApiNumberSummary {
  return {
    count: accumulator.count,
    min: accumulator.min,
    max: accumulator.max,
    total: accumulator.total,
    average: accumulator.total / accumulator.count
  };
}

function addUsage(totals: RealApiUsageTotals, usage: AiApiUsage): void {
  totals.promptTokens += usage.promptTokens ?? 0;
  totals.completionTokens += usage.completionTokens ?? 0;
  totals.totalTokens += usage.totalTokens ?? 0;
  totals.cachedPromptTokens += usage.cachedPromptTokens ?? 0;
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
}
