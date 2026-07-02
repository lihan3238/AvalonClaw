import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRealApiResultJsonl, auditRealApiGame, summarizeRealApiTrace, type RealApiTraceEntry } from "./realApiTrace";

describe("real API trace diagnostics", () => {
  it("summarizes fallbacks and speech repairs by reason, detail, action, and model tier", () => {
    const trace: RealApiTraceEntry[] = [
      {
        source: "model",
        actionKind: "vote",
        modelTier: "weak",
        promptMetrics: { messageCount: 2, systemChars: 90, userChars: 240, totalChars: 330 },
        apiUsage: { promptTokens: 120, completionTokens: 18, totalTokens: 138, cachedPromptTokens: 64 },
        apiTiming: { durationMs: 1200, attempts: 1 },
        speechRepairReason: "missing-speech"
      },
      {
        source: "fallback",
        actionKind: "vote",
        modelTier: "weak",
        requestedReasoningEffort: "high",
        reasoningEffort: "medium",
        promptMetrics: { messageCount: 2, systemChars: 90, userChars: 260, totalChars: 350 },
        apiUsage: { promptTokens: 130, completionTokens: 17, totalTokens: 147, reasoningTokens: 6 },
        apiTiming: { durationMs: 2400, attempts: 2 },
        fallbackReason: "invalid-json",
        fallbackDetail: "invalid-decision-shape"
      },
      {
        source: "fallback",
        actionKind: "proposeTeam",
        modelTier: "strong",
        requestedReasoningEffort: "high",
        reasoningEffort: "high",
        apiTiming: { durationMs: 45000, attempts: 3 },
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
      promptChars: { count: 2, min: 330, max: 350, total: 680, average: 340 },
      promptCharsByActionKind: { vote: { count: 2, min: 330, max: 350, total: 680, average: 340 } },
      apiUsageTotals: { promptTokens: 250, completionTokens: 35, totalTokens: 285, cachedPromptTokens: 64, reasoningTokens: 6 },
      apiTiming: { count: 3, min: 1200, max: 45000, total: 48600, average: 16200 },
      apiAttempts: 6,
      apiTimingBySource: {
        model: { count: 1, min: 1200, max: 1200, total: 1200, average: 1200 },
        fallback: { count: 2, min: 2400, max: 45000, total: 47400, average: 23700 }
      },
      apiAttemptsBySource: { model: 1, fallback: 5 },
      apiTimingByFallbackReason: {
        "invalid-json": { count: 1, min: 2400, max: 2400, total: 2400, average: 2400 },
        "api-timeout": { count: 1, min: 45000, max: 45000, total: 45000, average: 45000 }
      },
      apiAttemptsByFallbackReason: { "invalid-json": 2, "api-timeout": 3 },
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

  it("audits public-fact and strategy issues without hard-coding player seats", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p3", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p1", "p4", "p5"] }, speech: "Clean team." },
        { step: 3, playerId: "p3", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: true }, speech: "队伍里有可操作位，先过。" },
        { step: 4, playerId: "p1", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: true }, speech: "This public-good team is fine." },
        { step: 5, playerId: "p4", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: true }, speech: "Approve." },
        { step: 6, playerId: "p2", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: false }, speech: "Reject." },
        { step: 7, playerId: "p5", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: false }, speech: "Reject." }
      ]
    })).toEqual({
      publicFacts: {
        publicEvil: ["p2", "p3"],
        publicGood: ["p1", "p4", "p5"]
      },
      allPublicGoodEvilProposals: [{ step: 2, playerId: "p3", teamIds: ["p1", "p4", "p5"] }],
      evilApproveAllPublicGoodTeams: [{ step: 3, playerId: "p3", teamIds: ["p1", "p4", "p5"] }],
      evilApproveNoTrueEvilTeams: [{ step: 3, playerId: "p3", teamIds: ["p1", "p4", "p5"] }],
      evilNonPivotalApproveAllPublicGoodTeams: [],
      evilNonPivotalApproveNoTrueEvilTeams: [],
      goodApprovePublicEvilTeams: [],
      goodProposePublicEvilTeams: [],
      unrepairedSecretLeaks: [{ step: 3, playerId: "p3", speech: "队伍里有可操作位，先过。" }],
      promptCodeLeaks: [],
      publicFactOverclaims: []
    });
  });

  it("separates evil camouflage approvals from approvals required to pass all-public-good teams", () => {
    const base = {
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" as const },
        { playerId: "p2", allegiance: "good" as const },
        { playerId: "p3", allegiance: "evil" as const },
        { playerId: "p4", allegiance: "good" as const },
        { playerId: "p5", allegiance: "good" as const }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest" as const, source: "local" as const, modelTier: "weak" as const, action: { type: "quest" as const, card: "fail" as const }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest" as const, source: "local" as const, modelTier: "weak" as const, action: { type: "quest" as const, card: "fail" as const }, speech: "Resolving." },
        { step: 2, playerId: "p4", actionKind: "proposeTeam" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "proposeTeam" as const, teamIds: ["p2", "p4"] }, speech: "提2、4。" },
        { step: 3, playerId: "p1", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: true }, speech: "先过看票型。" },
        { step: 4, playerId: "p2", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: true }, speech: "Approve." },
        { step: 5, playerId: "p3", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: false }, speech: "Reject." },
        { step: 6, playerId: "p4", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: true }, speech: "Approve." }
      ]
    };

    const nonPivotal = auditRealApiGame({
      ...base,
      trace: [
        ...base.trace,
        { step: 7, playerId: "p5", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: true }, speech: "Approve." }
      ]
    });
    expect(nonPivotal.evilApproveAllPublicGoodTeams).toEqual([]);
    expect(nonPivotal.evilApproveNoTrueEvilTeams).toEqual([]);
    expect(nonPivotal.evilNonPivotalApproveAllPublicGoodTeams).toEqual([
      { step: 3, playerId: "p1", teamIds: ["p2", "p4"] }
    ]);
    expect(nonPivotal.evilNonPivotalApproveNoTrueEvilTeams).toEqual([
      { step: 3, playerId: "p1", teamIds: ["p2", "p4"] }
    ]);

    const requiredForPass = auditRealApiGame({
      ...base,
      trace: [
        ...base.trace,
        { step: 7, playerId: "p5", actionKind: "vote" as const, source: "model" as const, modelTier: "weak" as const, action: { type: "vote" as const, approve: false }, speech: "Reject." }
      ]
    });
    expect(requiredForPass.evilApproveAllPublicGoodTeams).toEqual([
      { step: 3, playerId: "p1", teamIds: ["p2", "p4"] }
    ]);
    expect(requiredForPass.evilApproveNoTrueEvilTeams).toEqual([
      { step: 3, playerId: "p1", teamIds: ["p2", "p4"] }
    ]);
    expect(requiredForPass.evilNonPivotalApproveAllPublicGoodTeams).toEqual([]);
    expect(requiredForPass.evilNonPivotalApproveNoTrueEvilTeams).toEqual([]);
  });

  it("audits all-public-good evil proposals from combined public constraints", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p4", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p1", "p3"] }, speech: "Next test." },
        { step: 3, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 4, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 5, playerId: "p5", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p2", "p3"] }, speech: "Next test." },
        { step: 6, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 7, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 8, playerId: "p3", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p4", "p5"] }, speech: "我提 p4+p5。" }
      ]
    })).toMatchObject({
      publicFacts: {
        publicGood: ["p4", "p5"],
        publicEvil: []
      },
      allPublicGoodEvilProposals: [{ step: 8, playerId: "p3", teamIds: ["p4", "p5"] }]
    });
  });

  it("flags speech that overclaims public alignments after partial fail evidence", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "公共事实显示 p3 为恶阵营，p2、p4、p5 可视为公开好人。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 2, playerId: "p4", speech: "公共事实显示 p3 为恶阵营，p2、p4、p5 可视为公开好人。" }
    ]);
  });

  it("flags definitive off-team good claims after partial fail evidence", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "当前已知 p1+p2 中至少一坏，因此 p3 可视为公正。" },
        { step: 3, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "p3 虽然是好人，但这个队伍仍然有风险。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 2, playerId: "p4", speech: "当前已知 p1+p2 中至少一坏，因此 p3 可视为公正。" },
      { step: 3, playerId: "p5", speech: "p3 虽然是好人，但这个队伍仍然有风险。" }
    ]);
  });

  it("flags zero-fail quests being treated as hard public-good proof", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p1", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "从硬信息看，p1和p4是已验证的公好位。" },
        { step: 3, playerId: "p2", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "Q1的p1+p4零失败，说明p1、p4可视为公善。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 2, playerId: "p1", speech: "从硬信息看，p1和p4是已验证的公好位。" },
      { step: 3, playerId: "p2", speech: "Q1的p1+p4零失败，说明p1、p4可视为公善。" }
    ]);
  });

  it("flags known-reliable wording before a player is publicly hard-good", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p1", "p2"] }, speech: "带上已知可靠的1号，再配一名较稳的2号。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 0, playerId: "p1", speech: "带上已知可靠的1号，再配一名较稳的2号。" }
    ]);
  });

  it("does not flag question wording about another player's stability as a public-good overclaim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "这队至少能带来新的发言对比，我先倾向放过；不过后续我会重点看 p4 的站位是否稳定。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag lack-of-public-evil-evidence wording as a public-evil overclaim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: true }, speech: "从我视角，p1+p3 这组目前没有足够的公开坏证据，先支持继续看结果。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag not-publicly-cleared wording as a public-good overclaim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p5", actionKind: "vote", source: "model", modelTier: "strong", action: { type: "vote", approve: false }, speech: "两条任务都只到“至少一坏”，1和4并没有被公开排干净；这队把1直接放进来风险偏高，我更想先看不带1的两人案。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag comparative clean wording as a hard public-good overclaim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "从我视角看，p1+p2是当前比较干净、好验证的起手队；先走这组，后面更容易对比其他人发言。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag cautious partial-fail or negated zero-fail statements as public fact overclaims", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p1", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "Q3仅能确定队伍 p3/p4 至少有一名坏人，其他人仍属未测。" },
        { step: 3, playerId: "p2", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "p1、p2有0失败记录但不构成好人证明，不能直接洗白。" },
        { step: 4, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "p1和p4都未被公开证明为好人，这队不够稳，先拒绝。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag zero-fail result-only statements as public-good overclaims", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "1、2首轮0失败只说明当时结果干净，不代表谁被公认安全。" },
        { step: 3, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "首轮1、2的0失败只代表结果干净，不能把1、2直接当定论。" },
        { step: 4, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "1、2首轮零失败只代表结果干净，不代表谁绝对安全。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag zero-bad shorthand as public alignment when it only describes a quest result", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p2", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "首轮1、2是0坏，说明这条线至少值得继续拿信息，但0坏不等于定身份。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows self-view alignment reasoning without treating it as a public fact overclaim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p5", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 3, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "从我p4视角，我自己是好人，所以Q2的p1+p4+p5若有1坏，更应在p1/p5里找。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows self-view numbered alignment reasoning without treating it as public hard-good", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "speak", source: "model", modelTier: "strong", action: { type: "speak" }, speech: "公开只到2、4至少一坏；从我视角1是好人，所以5这边仍有风险。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("flags self-known alignment when it is presented as public information", () => {
    const speech = "公开信息里，Q2 的 p1+p4+p5 出过 1 失败，而 p4 已知是好人，所以 p1、p5 里至少有一坏。";

    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p5", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 3, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 3, playerId: "p4", speech }
    ]);
  });

  it("does not treat no-known-evil wording on a public-good team as a public-evil claim", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p3", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p3", "p4", "p5"] }, speech: "走三人队。" },
        { step: 3, playerId: "p1", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "当前提案 p3+p4+p5 不含已知坏人，是最直接的三人队。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows one-bad team-result statements without marking each team member public evil", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "公开结果里1、4在Q3同队出过1坏，至少说明这对里有问题；这轮再把5一起带上，如果任务出事，1/4/5很难拆归因。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows public exact-evil-count group claims without marking each group member public evil", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p2", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }, speech: "Next test." },
        { step: 3, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 4, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 5, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 6, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "公开只能确定1、2、3里正好两坏，4、5是好人；1、3双人队撞到两坏的风险过高。" },
        { step: 7, playerId: "p2", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: false }, speech: "拒绝：公开信息显示1、2、3中有两坏，这队1、3风险偏高。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows slash-separated one-bad group claims without marking each group member public evil", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "proposeTeam", source: "model", modelTier: "strong", action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }, speech: "公开结果已经能收缩到：2/4里一坏，1/3/5里一坏。三人队就先按一边取1人、一边取2人来组。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("allows exact bad-count pressure on a group while still accepting valid hard-good claims", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p5", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 3, playerId: "p2", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "公开结果里Q4的2坏把问题基本压在1/4/5中，而2、3是公开确定的好人；这队先排掉4、5。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("flags known-no-evil claims as public-good overclaims when no hard fact proves them", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "good" },
        { playerId: "p4", allegiance: "evil" },
        { playerId: "p5", allegiance: "evil" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 1, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p1", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "通过：p1、p2来自已知无坏的结果，队伍偏安全。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 2, playerId: "p1", speech: "通过：p1、p2来自已知无坏的结果，队伍偏安全。" }
    ]);
  });

  it("does not flag valid public-good conclusions after all evil are exposed by an all-fail quest", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p5", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p2", "p4", "p5"] }, speech: "避开已暴露的两人，保留已验证的好人。" },
        { step: 3, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "按硬事实：p1、p3 已被 2F 直接打成公恶；p2、p4、p5 目前都只是待验，不能说安全。" },
        { step: 4, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "p2+p4+p5都在Q1之外；Q1的2次失败已硬证p1、p3为公敌，因此这个3人队从硬事实看全是公好。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("does not flag mixed hard-good and hard-evil claims in the same clause", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "evil" },
        { playerId: "p2", allegiance: "good" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p1", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "我不支持1、2：公开信息里1是坏、2是好，把1再带进两人队没有收益。" }
      ]
    }).publicFactOverclaims).toEqual([]);
  });

  it("flags score-history group good overclaims before the later quest makes them public facts", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p5", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 2, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 3, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 4, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 5, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "更稳的备选是带上已被战绩压成好位的 p1、p4、p5 里的人来重组。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 5, playerId: "p5", speech: "更稳的备选是带上已被战绩压成好位的 p1、p4、p5 里的人来重组。" }
    ]);
  });

  it("flags unrepaired self-side leaks without blocking accusations against other players", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: true }, speech: "p2作恶阵营，提名队伍包含我，适合通过以争取优势。" },
        { step: 1, playerId: "p4", actionKind: "vote", source: "model", modelTier: "weak", action: { type: "vote", approve: false }, speech: "p2作恶阵营，我先不同意。" }
      ]
    }).unrepairedSecretLeaks).toEqual([
      { step: 0, playerId: "p2", speech: "p2作恶阵营，提名队伍包含我，适合通过以争取优势。" }
    ]);
  });

  it("flags internal perspective labels as prompt-code leaks", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "SELF_FACT 里我是好人，所以这队可过。" },
        { step: 1, playerId: "p5", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "PUBLIC_FACT 只给了 p2/p3 风险。" }
      ]
    }).promptCodeLeaks).toEqual([
      { step: 0, playerId: "p4", speech: "SELF_FACT 里我是好人，所以这队可过。" },
      { step: 1, playerId: "p5", speech: "PUBLIC_FACT 只给了 p2/p3 风险。" }
    ]);
  });

  it("does not treat self-suspicion wording as a secret leak while still allowing public-fact audits", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "这队固定是 p1、p3、p5，已知 p3 明显偏恶，p5也高度可疑。" },
        { step: 1, playerId: "p4", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "我觉得 p3 明显偏恶，这队风险太高。" },
        { step: 2, playerId: "p3", actionKind: "speak", source: "model", modelTier: "weak", action: { type: "speak" }, speech: "我不是坏人，这队仍然要按公开结果讨论。" }
      ]
    }).unrepairedSecretLeaks).toEqual([]);
  });

  it("flags pronoun-based public-evil overclaims after exact evil-count evidence on an oversized team", () => {
    expect(auditRealApiGame({
      modelAssignments: [
        { playerId: "p1", allegiance: "good" },
        { playerId: "p2", allegiance: "evil" },
        { playerId: "p3", allegiance: "evil" },
        { playerId: "p4", allegiance: "good" },
        { playerId: "p5", allegiance: "good" }
      ],
      trace: [
        { step: 0, playerId: "p2", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 1, playerId: "p3", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "fail" }, speech: "Resolving." },
        { step: 2, playerId: "p4", actionKind: "quest", source: "local", modelTier: "weak", action: { type: "quest", card: "success" }, speech: "Resolving." },
        { step: 3, playerId: "p3", actionKind: "proposeTeam", source: "model", modelTier: "weak", action: { type: "proposeTeam", teamIds: ["p2", "p3"] }, speech: "p2、p3都在一轮两张失败的任务里；按公开结果，这整队全是邪恶位，所以这队最硬。" }
      ]
    }).publicFactOverclaims).toEqual([
      { step: 3, playerId: "p3", speech: "p2、p3都在一轮两张失败的任务里；按公开结果，这整队全是邪恶位，所以这队最硬。" }
    ]);
  });
});
