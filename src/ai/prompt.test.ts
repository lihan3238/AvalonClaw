import { castVote, createInitialGame, proposeTeam, submitQuestCard } from "../game/rules";
import { buildAIPrompt, createPersona, extractJsonObject, parseAiDecision } from "./prompt";
import type { LegalAction } from "./types";

describe("AI prompt private information", () => {
  const state = createInitialGame({
    playerCount: 7,
    roles: ["merlin", "percival", "loyal", "assassin", "morgana", "mordred", "oberon"]
  });

  it("tells Merlin evil ids except Mordred", () => {
    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 7),
      reasoningEffort: "high"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Known evil players: p4, p5, p7");
    expect(prompt).not.toContain("Known evil players: p4, p5, p6, p7");
    expect(prompt).toContain("Mordred may be hidden from Merlin");
  });

  it("shows Percival ambiguous Merlin candidates without asserting which is real", () => {
    const prompt = buildAIPrompt({
      state,
      playerId: "p2",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p2", 7),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Merlin candidates: p1, p5");
    expect(prompt).toContain("Do not state that either candidate is certainly Merlin");
  });

  it("does not leak hidden roles to Loyal Servants", () => {
    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p3", 7),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Known evil players: none");
    expect(prompt).toContain("Merlin candidates: none");
    expect(prompt).not.toContain("p4=Assassin");
    expect(prompt).not.toContain("p5=Morgana");
  });
});

describe("AI prompt public vote information", () => {
  it("hides individual votes until every player has voted", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p2"]);
    state = castVote(state, "p2", true);

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p3", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Vote submissions: 1 of 5 submitted");
    expect(prompt).toContain("individual votes are hidden until all players have voted");
    expect(prompt).not.toContain("p2:approve");
  });

  it("hides individual quest cards until the quest result is resolved", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p4"]);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }
    state = submitQuestCard(state, "p1", "success");

    const prompt = buildAIPrompt({
      state,
      playerId: "p4",
      actionKind: "quest",
      legalActions: [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }],
      persona: createPersona("p4", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Quest card submissions: 1 of 2 submitted");
    expect(prompt).toContain("individual quest cards are hidden");
    expect(prompt).not.toContain("p1:success");
  });
});

describe("AI response parsing", () => {
  const legalVotes: LegalAction[] = [{ type: "vote", approve: true }, { type: "vote", approve: false }];

  it("extracts the first JSON object from chatty model output", () => {
    expect(extractJsonObject('I choose this:\n{"speech":"Looks reasonable.","action":{"type":"vote","approve":true}}\nDone.')).toBe(
      '{"speech":"Looks reasonable.","action":{"type":"vote","approve":true}}'
    );
  });

  it("accepts valid JSON when action is legal", () => {
    const decision = parseAiDecision('{"speech":"Approve this team.","action":{"type":"vote","approve":true}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    });

    expect(decision).toEqual({ speech: "Approve this team.", action: { type: "vote", approve: true }, source: "model" });
  });

  it("falls back when JSON is malformed or the action is illegal", () => {
    const fallback = { speech: "No legal model action. Rejecting.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision("not json", legalVotes, fallback)).toEqual({ ...fallback, source: "fallback" });
    expect(parseAiDecision('{"speech":"Skip","action":{"type":"vote","approve":"maybe"}}', legalVotes, fallback)).toEqual({
      ...fallback,
      source: "fallback"
    });
  });
});
