import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRealApiResultJsonl, summarizeRealApiTrace, type RealApiTraceEntry } from "./realApiTrace";

describe("real API trace diagnostics", () => {
  it("summarizes fallbacks and speech repairs by reason, detail, action, and model tier", () => {
    const trace: RealApiTraceEntry[] = [
      {
        source: "model",
        actionKind: "vote",
        modelTier: "weak",
        speechRepairReason: "missing-speech"
      },
      {
        source: "fallback",
        actionKind: "vote",
        modelTier: "weak",
        requestedReasoningEffort: "high",
        reasoningEffort: "medium",
        fallbackReason: "invalid-json",
        fallbackDetail: "invalid-decision-shape"
      },
      {
        source: "fallback",
        actionKind: "proposeTeam",
        modelTier: "strong",
        requestedReasoningEffort: "high",
        reasoningEffort: "high",
        fallbackReason: "api-timeout"
      },
      {
        source: "local",
        actionKind: "quest",
        modelTier: "weak"
      }
    ];

    expect(summarizeRealApiTrace(trace)).toEqual({
      steps: 4,
      modelActions: 1,
      localActions: 1,
      fallbackCount: 2,
      fallbacksByReason: { "invalid-json": 1, "api-timeout": 1 },
      fallbacksByDetail: { "invalid-decision-shape": 1 },
      fallbacksByActionKind: { vote: 1, proposeTeam: 1 },
      fallbacksByModelTier: { weak: 1, strong: 1 },
      fallbacksByReasoningEffort: { medium: 1, high: 1 },
      fallbacksByRequestedReasoningEffort: { high: 2 },
      localByActionKind: { quest: 1 },
      speechRepairsByReason: { "missing-speech": 1 }
    });
  });

  it("appends real API game results as JSON lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "avalon-trace-"));
    const outputPath = join(dir, "results.jsonl");
    try {
      appendRealApiResultJsonl(outputPath, { game: 1, diagnostics: { fallbackCount: 0 } });
      appendRealApiResultJsonl(outputPath, { game: 2, diagnostics: { fallbackCount: 1 } });

      expect(readFileSync(outputPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
        { game: 1, diagnostics: { fallbackCount: 0 } },
        { game: 2, diagnostics: { fallbackCount: 1 } }
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
