import { advanceDiscussionTurn, castVote, createInitialGame, proposeTeam } from "../src/game/rules";
import { createAiActionResult, effectiveReasoningEffortForAction } from "./aiEndpoint";
import { resetOpenAIProtocolPreferences } from "./openaiCompatible";
import type { OpenAICompatibleConfig } from "./env";

describe("AI endpoint orchestration", () => {
  const state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

  beforeEach(() => {
    resetOpenAIProtocolPreferences();
  });

  it("uses fallback when API config is missing", async () => {
    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p1",
        actionKind: "proposeTeam",
        legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2"] }],
        reasoningEffort: "medium"
      }
    });

    expect(result.source).toBe("fallback");
    expect(result.fallbackReason).toBe("missing-config");
    expect(result.action).toEqual({ type: "proposeTeam", teamIds: ["p1", "p2"] });
  });

  it("uses manually supplied request config for model calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "{\"speech\":\"Approve.\",\"action\":{\"type\":\"vote\",\"approve\":true}}" } }]
      }), { status: 200 })
    );

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high",
        model: "model-body",
        aiConfig: {
          baseURL: "https://manual.example/v1/",
          apiKey: "manual-key"
        }
      },
      fetchImpl
    });

    expect(result).toMatchObject({ source: "model", action: { type: "vote", approve: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://manual.example/v1/responses");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer manual-key");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("model-body");
  });

  it("calls the model and returns a validated model action when config is usable", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "{\"speech\":\"Approve.\",\"action\":{\"type\":\"vote\",\"approve\":true}}" } }],
        usage: { prompt_tokens: 211, completion_tokens: 19, total_tokens: 230, prompt_tokens_details: { cached_tokens: 64 } }
      }), {
        status: 200
      })
    );

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "model", action: { type: "vote", approve: true } });
    expect(result.promptMetrics).toMatchObject({ messageCount: 2, totalChars: expect.any(Number) });
    expect(result.apiUsage).toEqual({ promptTokens: 211, completionTokens: 19, totalTokens: 230, cachedPromptTokens: 64 });
    expect(result.apiTiming).toMatchObject({ attempts: 1, durationMs: expect.any(Number) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("passes the selected reasoning effort through while keeping quest cards local", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}" } }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"This read fits.\",\"a\":{\"t\":\"as\",\"id\":\"p1\"}}" } }] }), { status: 200 })
      );
    let questState = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    questState = proposeTeam(questState, "p1", ["p1", "p4"]);
    questState = finishDiscussion(questState);
    for (const player of questState.players) {
      questState = castVote(questState, player.id, true);
    }

    await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "xhigh"
      },
      config,
      fetchImpl
    });
    const questResult = await createAiActionResult({
      body: {
        state: questState,
        playerId: "p4",
        actionKind: "quest",
        legalActions: [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }],
        reasoningEffort: "xhigh"
      },
      config,
      fetchImpl
    });
    const assassinationState = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3", "p4"], failCards: 0, succeeded: true },
        { teamIds: ["p2", "p3"], failCards: 0, succeeded: true }
      ]
    });
    await createAiActionResult({
      body: {
        state: assassinationState,
        playerId: "p4",
        actionKind: "assassinate",
        legalActions: [
          { type: "assassinate", targetId: "p1" },
          { type: "assassinate", targetId: "p2" },
          { type: "assassinate", targetId: "p3" }
        ],
        reasoningEffort: "xhigh"
      },
      config,
      fetchImpl
    });

    const voteBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const assassinateBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(voteBody.reasoning).toEqual({ effort: "medium" });
    expect(voteBody.input[1].content).toContain("A=v R=m:");
    expect(questResult).toMatchObject({ source: "local", action: { type: "quest", card: "fail" } });
    expect(effectiveReasoningEffortForAction("vote", "xhigh")).toBe("medium");
    expect(effectiveReasoningEffortForAction("speak", "high")).toBe("medium");
    expect(effectiveReasoningEffortForAction("quest", "xhigh")).toBe("low");
    expect(assassinateBody.reasoning).toEqual({ effort: "high" });
    expect(assassinateBody.input[1].content).toContain("A=as R=h:");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("resolves quest cards locally without spending an API call", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn();
    let questState = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    questState = proposeTeam(questState, "p1", ["p1", "p4"]);
    questState = finishDiscussion(questState);
    for (const player of questState.players) {
      questState = castVote(questState, player.id, true);
    }

    const result = await createAiActionResult({
      body: {
        state: questState,
        playerId: "p1",
        actionKind: "quest",
        legalActions: [{ type: "quest", card: "success" }],
        reasoningEffort: "low"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "local", action: { type: "quest", card: "success" } });
    expect(fetchImpl).not.toHaveBeenCalled();

    const evilResult = await createAiActionResult({
      body: {
        state: questState,
        playerId: "p4",
        actionKind: "quest",
        legalActions: [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(evilResult).toMatchObject({ source: "local", action: { type: "quest", card: "fail" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hard-blocks action kinds that are illegal for the current state before prompting", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn();

    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p1",
        actionKind: "speak",
        legalActions: [{ type: "speak" }],
        reasoningEffort: "medium"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({
      source: "fallback",
      fallbackReason: "illegal-action",
      fallbackDetail: "illegal-action"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports illegal model actions as fallback diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{\"speech\":\"I propose this.\",\"action\":{\"type\":\"proposeTeam\",\"teamIds\":[\"p1\",\"p2\"]}}" } }] }), {
        status: 200
      })
    );

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "fallback", fallbackReason: "illegal-action", action: { type: "vote", approve: true } });
  });

  it("can include raw model content for manual trace diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const modelContent = "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: modelContent } }] }), { status: 200 })
    );

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "low"
      },
      config,
      fetchImpl,
      includeRawModelContent: true
    });

    expect(result).toMatchObject({
      source: "model",
      action: { type: "vote", approve: true },
      rawModelContent: modelContent
    });
  });

  it("reports API failures as fallback diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 500 })
    ));

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({
      source: "fallback",
      fallbackReason: "api-http-error",
      fallbackDiagnostic: expect.stringContaining("500"),
      apiTiming: { attempts: 3, durationMs: expect.any(Number) }
    });
    expect(result.fallbackDiagnostic).toContain("upstream unavailable");
  });

  it("preserves classified API fallback diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await createAiActionResult({
      body: {
        state: createVotingState(),
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "fallback", fallbackReason: "api-invalid-response" });
  });
});

function finishDiscussion(state: ReturnType<typeof createInitialGame>) {
  let next = state;
  while (next.phase === "discussion") {
    const speaker = next.players[next.discussion?.nextSpeakerIndex ?? 0];
    next = advanceDiscussionTurn(next, speaker.id);
  }
  return next;
}

function createVotingState() {
  let next = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
  next = proposeTeam(next, "p1", ["p1", "p2"]);
  return finishDiscussion(next);
}
