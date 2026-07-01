import { castVote, createInitialGame, proposeTeam } from "../src/game/rules";
import { createAiActionResult } from "./aiEndpoint";
import type { OpenAICompatibleConfig } from "./env";

describe("AI endpoint orchestration", () => {
  const state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

  it("uses fallback when API config is missing", async () => {
    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p1",
        actionKind: "proposeTeam",
        legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2"] }],
        reasoningEffort: "medium"
      },
      config: { baseURL: "https://example.test/v1", apiKey: "", model: "model-a", timeoutMs: 1000 }
    });

    expect(result.source).toBe("fallback");
    expect(result.fallbackReason).toBe("missing-config");
    expect(result.action).toEqual({ type: "proposeTeam", teamIds: ["p1", "p2"] });
  });

  it("calls the model and returns a validated model action when config is usable", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{\"speech\":\"Approve.\",\"action\":{\"type\":\"vote\",\"approve\":true}}" } }] }), {
        status: 200
      })
    );

    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "model", action: { type: "vote", approve: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caps reasoning effort for short action kinds before prompting and transport", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}" } }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"Resolving.\",\"a\":{\"t\":\"q\",\"c\":\"fail\"}}" } }] }), { status: 200 })
      );
    let questState = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    questState = proposeTeam(questState, "p1", ["p1", "p4"]);
    for (const player of questState.players) {
      questState = castVote(questState, player.id, true);
    }

    await createAiActionResult({
      body: {
        state,
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });
    await createAiActionResult({
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

    const voteBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const questBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(voteBody.reasoning_effort).toBe("medium");
    expect(voteBody.messages[1].content).toContain("A=vote R=medium:");
    expect(questBody.reasoning_effort).toBe("low");
    expect(questBody.messages[1].content).toContain("A=quest R=low:");
  });

  it("resolves a single legal quest card locally without spending an API call", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn();
    let questState = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    questState = proposeTeam(questState, "p1", ["p1", "p2"]);
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
  });

  it("reports illegal model actions as fallback diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{\"speech\":\"Approve.\",\"action\":{\"type\":\"vote\",\"approve\":true}}" } }] }), {
        status: 200
      })
    );

    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "fallback", fallbackReason: "illegal-action", action: { type: "vote", approve: false } });
  });

  it("can include raw model content for manual trace diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const modelContent = "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: modelContent } }] }), { status: 200 })
    );

    const result = await createAiActionResult({
      body: {
        state,
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
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 500 }));

    const result = await createAiActionResult({
      body: {
        state,
        playerId: "p2",
        actionKind: "vote",
        legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
        reasoningEffort: "high"
      },
      config,
      fetchImpl
    });

    expect(result).toMatchObject({ source: "fallback", fallbackReason: "api-http-error" });
  });

  it("preserves classified API fallback diagnostics", async () => {
    const config: OpenAICompatibleConfig = { baseURL: "https://example.test/v1", apiKey: "key", model: "model-a", timeoutMs: 1000 };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await createAiActionResult({
      body: {
        state,
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
