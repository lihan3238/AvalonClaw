import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AiActionKind, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiSpeechRepairReason } from "../src/ai/types";

export type RealApiTraceModelTier = "strong" | "weak" | "uniform";

export interface RealApiTraceEntry {
  actionKind: AiActionKind;
  source: AiDecisionResult["source"];
  fallbackReason?: AiFallbackReason;
  fallbackDetail?: AiFallbackDetail;
  speechRepairReason?: AiSpeechRepairReason;
  modelTier: RealApiTraceModelTier;
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
  localByActionKind: Partial<Record<AiActionKind, number>>;
  speechRepairsByReason: Partial<Record<AiSpeechRepairReason, number>>;
}

export function summarizeRealApiTrace(trace: RealApiTraceEntry[]): RealApiTraceDiagnostics {
  const diagnostics: RealApiTraceDiagnostics = {
    steps: trace.length,
    modelActions: 0,
    localActions: 0,
    fallbackCount: 0,
    fallbacksByReason: {},
    fallbacksByDetail: {},
    fallbacksByActionKind: {},
    fallbacksByModelTier: {},
    localByActionKind: {},
    speechRepairsByReason: {}
  };

  for (const entry of trace) {
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

  return diagnostics;
}

export function appendRealApiResultJsonl(outputPath: string, result: unknown): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
}

function increment<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
