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

    expect(prompt).toContain("KE=p4,p5,p7");
    expect(prompt).not.toContain("KE=p4,p5,p6,p7");
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

    expect(prompt).toContain("MC=p1,p5");
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

    expect(prompt).toContain("KE=-");
    expect(prompt).toContain("MC=-");
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

    expect(prompt).toContain("V=1/5:hidden");
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

    expect(prompt).toContain("QC=1/2:hidden");
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

    expect(prompt).toContain("TT oldest>newest");
    expect(prompt).toContain("1|p1|AI 1|I trust p2 first.");
    expect(prompt).toContain("2|p2|AI 2|That trust came too early.");
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
    expect(prompt).toContain("LA pt n=5 ids=p1,p2,p3,p4,p5,p6,p7,p8,p9,p10");
    expect(prompt).not.toContain(JSON.stringify(legalActions));
    expect(prompt).not.toContain("Private information:");
    expect(prompt).not.toContain("Public game state:");
    expect(prompt).not.toContain("Role strategy:");
    expect(prompt).toContain("No public role words");
    expect(prompt).toContain("OUT ");
    expect(prompt.length).toBeLessThan(1800);
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

  it("accepts compact AI-only JSON aliases and normalizes them to game actions", () => {
    expect(parseAiDecision('{"s":"Approve.","a":{"t":"v","ok":true}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({ speech: "Approve.", action: { type: "vote", approve: true }, source: "model" });

    expect(parseAiDecision('{"s":"Same team.","a":{"t":"pt","ids":["p2","p1"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2"] }], {
      speech: "Fallback",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({ speech: "Same team.", action: { type: "proposeTeam", teamIds: ["p2", "p1"] }, source: "model" });

    expect(parseAiDecision('{"s":"Resolving.","a":{"t":"q","c":"success"}}', [{ type: "quest", card: "success" }], {
      speech: "Fallback",
      action: { type: "quest", card: "success" }
    })).toEqual({ speech: "Fallback", action: { type: "quest", card: "success" }, source: "model", speechRepairReason: "quest-card-speech" });

    expect(parseAiDecision('{"s":"Targeting.","a":{"t":"as","id":"p3"}}', [{ type: "assassinate", targetId: "p3" }], {
      speech: "Fallback",
      action: { type: "assassinate", targetId: "p2" }
    })).toEqual({ speech: "Targeting.", action: { type: "assassinate", targetId: "p3" }, source: "model" });
  });

  it("accepts action-only JSON and repairs missing public speech", () => {
    expect(parseAiDecision('{"t":"v","ok":true}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "missing-speech"
    });
    expect(parseAiDecision('{"type":"vote","approve":false}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "I want a cleaner proposal before approving.",
      action: { type: "vote", approve: false },
      source: "model",
      speechRepairReason: "missing-speech"
    });
    expect(parseAiDecision('{"t":"pt","ids":["p2","p1"]}', [{ type: "proposeTeam", teamIds: ["p1", "p2"] }], {
      speech: "Fallback",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({
      speech: "Fallback",
      action: { type: "proposeTeam", teamIds: ["p2", "p1"] },
      source: "model",
      speechRepairReason: "missing-speech"
    });
  });

  it("repairs unsafe or low-quality public speech while keeping legal model actions", () => {
    const fallback = { speech: "Safe fallback speech.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision('{"s":"p1 and p4 both still read as plausible Merlin material.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "unsafe-role-word"
    });
    expect(parseAiDecision('{"s":"<=160 public","a":{"t":"pt","ids":["p1","p2","p3"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }], {
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }
    })).toEqual({
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"v","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "low-information"
    });
    expect(parseAiDecision('{"s":"p1,p2,p3","a":{"t":"pt","ids":["p1","p2","p3"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }], {
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }
    })).toEqual({
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] },
      source: "model",
      speechRepairReason: "low-information"
    });
  });

  it("repairs public speech that contradicts the chosen vote action", () => {
    const fallback = { speech: "I want a cleaner proposal before approving.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision('{"s":"That lineup looks risky; I would avoid p3 here and prefer a cleaner mix.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "action-mismatch"
    });
    expect(parseAiDecision('{"s":"I would rather see more consistency before greenlighting this one.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "action-mismatch"
    });
    expect(parseAiDecision('{"s":"Looks reasonable; voting yes.","a":{"t":"v","ok":false}}', legalVotes, {
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "I want a cleaner proposal before approving.",
      action: { type: "vote", approve: false },
      source: "model",
      speechRepairReason: "action-mismatch"
    });
  });

  it("repairs quest-phase speech so secret quest cards are never implied publicly", () => {
    expect(parseAiDecision('{"s":"Lean into the pattern; I am taking the disruptive line here.","a":{"t":"q","c":"fail"}}', [
      { type: "quest", card: "success" },
      { type: "quest", card: "fail" }
    ], {
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" }
    })).toEqual({
      speech: "I am resolving the quest.",
      action: { type: "quest", card: "fail" },
      source: "model",
      speechRepairReason: "quest-card-speech"
    });
    expect(parseAiDecision('{"s":"I am playing clean for the team.","a":{"t":"q","c":"success"}}', [
      { type: "quest", card: "success" }
    ], {
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" }
    })).toEqual({
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" },
      source: "model",
      speechRepairReason: "quest-card-speech"
    });
  });

  it("falls back when JSON is malformed or the action is illegal", () => {
    const fallback = { speech: "No legal model action. Rejecting.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision("not json", legalVotes, fallback)).toEqual({ ...fallback, source: "fallback", fallbackReason: "invalid-json" });
    expect(parseAiDecision('{"speech":"Skip","action":{"type":"vote","approve":"maybe"}}', legalVotes, fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "invalid-json"
    });
    expect(parseAiDecision('{"speech":"Illegal","action":{"type":"vote","approve":true}}', [{ type: "vote", approve: false }], fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "illegal-action"
    });
  });
});
