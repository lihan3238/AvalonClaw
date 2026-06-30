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

describe("AI prompt public talk order", () => {
  it("labels table talk in chronological order so agents can reason about timing", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      tableTalk: [
        { id: 1, speakerId: "p1", speakerName: "AI 1", text: "I trust p2 first." },
        { id: 2, speakerId: "p2", speakerName: "AI 2", text: "That trust came too early." }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("Chronological public talk; newest entry is last");
    expect(prompt).toContain("1. p1 AI 1: I trust p2 first.");
    expect(prompt).toContain("2. p2 AI 2: That trust came too early.");
  });
});

describe("AI prompt token budget", () => {
  it("keeps the system prompt stable so repeated calls can share a cacheable prefix", () => {
    const first = buildAIPrompt({
      state: createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] }),
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 5),
      reasoningEffort: "low",
      language: "en"
    }).messages[0].content;
    const second = buildAIPrompt({
      state: createInitialGame({ playerCount: 7, roles: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"] }),
      playerId: "p2",
      actionKind: "quest",
      legalActions: [{ type: "quest", card: "success" }],
      persona: createPersona("p2", 7),
      reasoningEffort: "high",
      language: "zh"
    }).messages[0].content;

    expect(first).toBe(second);
    expect(first.length).toBeLessThan(360);
  });

  it("summarizes proposal legality without enumerating every team combination", () => {
    const state = createInitialGame({
      playerCount: 10,
      roles: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred", "oberon"],
      questIndex: 4
    });
    const legalActions: LegalAction[] = [];
    const ids = state.players.map((player) => player.id);
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        for (let c = b + 1; c < ids.length; c += 1) {
          for (let d = c + 1; d < ids.length; d += 1) {
            for (let e = d + 1; e < ids.length; e += 1) {
              legalActions.push({ type: "proposeTeam", teamIds: [ids[a], ids[b], ids[c], ids[d], ids[e]] });
            }
          }
        }
      }
    }

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "proposeTeam",
      legalActions,
      persona: createPersona("p1", 10),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(legalActions).toHaveLength(252);
    expect(prompt).toContain("LA proposeTeam size=5 ids=p1,p2,p3,p4,p5,p6,p7,p8,p9,p10");
    expect(prompt).not.toContain(JSON.stringify(legalActions));
    expect(prompt.length).toBeLessThan(2600);
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

  it("accepts proposal teams regardless of player id order", () => {
    const legalTeams: LegalAction[] = [{ type: "proposeTeam", teamIds: ["p1", "p2"] }];
    const fallback = { speech: "Fallback", action: { type: "proposeTeam" as const, teamIds: ["p1", "p2"] } };

    expect(parseAiDecision('{"speech":"Same team, reversed.","action":{"type":"proposeTeam","teamIds":["p2","p1"]}}', legalTeams, fallback)).toEqual({
      speech: "Same team, reversed.",
      action: { type: "proposeTeam", teamIds: ["p2", "p1"] },
      source: "model"
    });
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
