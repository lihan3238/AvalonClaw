import { vi } from "vitest";
import { createInitialGame } from "../game/rules";
import { CLIENT_AI_REQUEST_TIMEOUT_MS, requestAiAction } from "./client";

const aiConfig = { baseURL: "https://example.test/v1", apiKey: "key" };

describe("AI browser client validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts a hung endpoint request and falls back instead of thinking forever", async () => {
    vi.useFakeTimers();
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));

    const pending = requestAiAction({
      state,
      playerId: "p1",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2"] }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });
    await vi.advanceTimersByTimeAsync(CLIENT_AI_REQUEST_TIMEOUT_MS + 1);

    await expect(pending).resolves.toMatchObject({
      source: "fallback",
      fallbackReason: "api-timeout",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    });
  });

  it("falls back locally when the endpoint returns an illegal action", async () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "model",
      speech: "I will send one player.",
      action: { type: "proposeTeam", teamIds: ["p1"] }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    const result = await requestAiAction({
      state,
      playerId: "p1",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2"] }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });

    expect(result).toEqual({
      source: "fallback",
      fallbackReason: "client-illegal-action",
      fallbackDetail: "illegal-action",
      speech: "I will keep this team straightforward and readable.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    });
  });

  it("preserves fallback source when the endpoint already used fallback", async () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "fallback",
      fallbackReason: "api-error",
      speech: "Endpoint fallback.",
      action: { type: "vote", approve: false }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    const result = await requestAiAction({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });

    expect(result).toEqual({
      source: "fallback",
      fallbackReason: "api-error",
      speech: "Endpoint fallback.",
      action: { type: "vote", approve: false }
    });
  });

  it("preserves local source when the endpoint resolved a deterministic action without the model", async () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "local",
      speech: "I am resolving the quest.",
      action: { type: "quest", card: "success" }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    const result = await requestAiAction({
      state,
      playerId: "p1",
      actionKind: "quest",
      legalActions: [{ type: "quest", card: "success" }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });

    expect(result).toEqual({
      source: "local",
      speech: "I am resolving the quest.",
      action: { type: "quest", card: "success" }
    });
  });

  it("preserves endpoint fallback detail diagnostics", async () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "malformed-json",
      speech: "Endpoint fallback.",
      action: { type: "vote", approve: false }
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));

    const result = await requestAiAction({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });

    expect(result).toEqual({
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "malformed-json",
      speech: "Endpoint fallback.",
      action: { type: "vote", approve: false }
    });
  });

  it("reports local network failures as fallback diagnostics", async () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const result = await requestAiAction({
      state,
      playerId: "p1",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2"] }],
      reasoningEffort: "low",
      language: "en",
      model: "model-a",
      aiConfig
    });

    expect(result).toEqual({
      source: "fallback",
      fallbackReason: "network-error",
      speech: "I will keep this team straightforward and readable.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    });
  });
});
