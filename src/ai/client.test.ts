import { vi } from "vitest";
import { createInitialGame } from "../game/rules";
import { requestAiAction } from "./client";

describe("AI browser client validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
      model: "model-a"
    });

    expect(result).toEqual({
      source: "fallback",
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
      model: "model-a"
    });

    expect(result).toEqual({
      source: "fallback",
      speech: "Endpoint fallback.",
      action: { type: "vote", approve: false }
    });
  });
});
