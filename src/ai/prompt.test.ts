import { advanceDiscussionTurn, castVote, createInitialGame, proposeTeam, submitQuestCard } from "../game/rules";
import { buildAIPrompt, createPersona, extractJsonObject, measurePromptMessages, parseAiDecision } from "./prompt";
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
    expect(prompt).toContain("ME p1@1 merlin good");
    expect(prompt).not.toContain("label=Merlin");
    expect(prompt).toContain("RW mh subtle coverA");
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
    expect(prompt).toContain("RW mc? coverM");
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
    expect(prompt).toContain("RW pub inferVQ");
    expect(prompt).not.toContain("p4=Assassin");
    expect(prompt).not.toContain("p5=Morgana");
  });

  it("includes the public game configuration and compact private-knowledge legend", () => {
    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 7),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("CFG n=7 good=3 evil=4 roles=merlin,percival,loyal,assassin,morgana,mordred,oberon");
    expect(prompt).toContain("KN KE=confirmed-private-evil MC=ambiguous-merlin-morgana");
  });

  it("provides public fail-card facts without prescribing good-team strategy", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p4"] }],
      persona: createPersona("p1", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("CFG n=5 good=3 evil=2");
    expect(prompt).toContain("H=Q1:p2+p3:2F:F");
    expect(prompt).toContain("LG failCards==teamSize => quest team all public-evil; failCards==CFG evil => outside quest public-good; apply before soft reads");
    expect(prompt).toContain("LG HARD use PF hardGood/hardEvil before every action; forced public facts beat trust/stable/clean words");
    expect(prompt).not.toContain("GOOD action check");
    expect(prompt).not.toContain("prefer public-good teams");
    expect(prompt).not.toContain("OBJ hard public facts beat stable/clean wording");
    expect(prompt).not.toContain("EV private action check");
    expect(prompt).not.toContain("EV public-fact check");
    expect(prompt).not.toContain("EV pt/v precheck");
    expect(prompt).not.toContain("never choose or approve all-public-good/off-slot teams");
    expect(prompt).not.toContain("p2,p3 are evil");
    expect(prompt).not.toContain("p1,p4,p5 are good");
  });

  it("warns that a partial fail result creates suspicion but no hard public alignments", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [{ teamIds: ["p1", "p3"], failCards: 1, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p4",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p4", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("LG partial fail: 0<failCards<teamSize and failCards<CFG evil => only at-least-one-on-team; no public-good/public-evil");
    expect(prompt).toContain("LG partial wording: say 至少一坏/at least one evil; never say 已知有1坏 or exactly-one unless LG exact evil-count says so");
    expect(prompt).toContain("LG partial outside: if failCards<CFG evil, off-team players are not public-good; call them untested/off-team, not clean/good");
    expect(prompt).toContain("LG example partial: team A+B 1F with evil=2 => A/B has >=1 evil; C/D/E are untested, never public-good");
    expect(prompt).toContain("LG group-count: exact/at-least evil counts are set facts; never lock a single player evil/good unless PF hardEvil/hardGood names that player");
    expect(prompt).toContain("LG no score-wash: history/score can create suspicion only; do not call score-made good/clean unless LG hard fact");
    expect(prompt).toContain("LG speech guard: say likely/read/suspicion unless LG hard fact proves public-good/public-evil");
    expect(prompt).toContain("H=Q1:p1+p3:1F:F");
    expect(prompt).not.toContain("p1,p3 are evil");
    expect(prompt).not.toContain("p2,p4,p5 are good");
  });

  it("warns that zero-fail quests do not prove the quest team public-good", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [{ teamIds: ["p1", "p4"], failCards: 0, succeeded: true }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p5",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      persona: createPersona("p5", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("H=Q1:p1+p4:0F:S");
    expect(prompt).toContain("LG zero-fail: 0F never proves quest team public-good; evil can play success to hide");
    expect(prompt).toContain("LG no no-evil: never call 0F/partial results known-no-evil or known-safe unless LG hard fact proves public-good");
    expect(prompt).toContain("LG speech guard: say likely/read/suspicion unless LG hard fact proves public-good/public-evil");
    expect(prompt).toContain("LG no reliability-cert: avoid known/verified/public/certain reliability wording unless PF hardGood proves it");
    expect(prompt).not.toContain("已知可靠");
    expect(prompt).not.toContain("known reliable");
    expect(prompt).not.toContain("p1,p4 are good");
  });

  it("warns that exact evil-count fails do not make an oversized quest team all public-evil", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [{ teamIds: ["p2", "p3", "p4"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p5",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      persona: createPersona("p5", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("H=Q1:p2+p3+p4:2F:F");
    expect(prompt).toContain("PF hardGood=p1,p5 hardEvil=-");
    expect(prompt).toContain("PF worlds=3");
    expect(prompt).toContain("LG exact evil-count but not all-fail: outside quest public-good only; quest team has exactly failCards evil, not all public-evil");
    expect(prompt).toContain("LG exact example: 3-player team 2F with evil=2 => off-team public-good; on-team has exactly 2 evil + 1 good, never whole-team evil");
    expect(prompt).toContain("LG whole-team evil only when failCards==teamSize; never call 2F on 3 players whole-team evil");
    expect(prompt).not.toContain("p2,p3,p4 are evil");
    expect(prompt).not.toContain("p1,p5 are good");
  });

  it("separates self-known allegiance from public hard facts in speech guidance", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [
        { teamIds: ["p2", "p3"], failCards: 1, succeeded: false },
        { teamIds: ["p1", "p4", "p5"], failCards: 1, succeeded: false }
      ]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p4",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      persona: createPersona("p4", 5),
      reasoningEffort: "medium",
      language: "zh"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("SELF_FACT self=p4 allegiance=good");
    expect(prompt).toContain("VIEW speech: self-known good is private perspective; say from my view/from p4 view, never public-known p4 good");
    expect(prompt).toContain("PUBLIC_FACT only PF hardGood/hardEvil; SELF_FACT/PRIVATE_FACT must not be called public information");
  });

  it("keeps self-known good claims out of public action reasons", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["loyal", "percival", "merlin", "assassin", "morgana"],
      leaderIndex: 2,
      questIndex: 1,
      questResults: [{ teamIds: ["p1", "p2"], failCards: 0, succeeded: true }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }],
      persona: createPersona("p3", 5),
      reasoningEffort: "low",
      language: "zh"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("SELF_FACT self=p3 allegiance=good");
    expect(prompt).toContain("VIEW public reason: self-known good is private perspective; say from my view/from p3 view, never 已知好人/known-good p3 unless PF hardGood proves it");
  });

  it("shows exposed evil players the same public facts without scripted recovery tactics", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      persona: createPersona("p3", 5),
      reasoningEffort: "low",
      language: "zh"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("PF hardGood=p1,p4,p5 hardEvil=p2,p3");
    expect(prompt).not.toContain("EV exposed self");
    expect(prompt).not.toContain("pivot to vote-track pressure");
    expect(prompt).not.toContain("claim you are good");
  });

  it("does not prescribe good voter choices when the current proposal contains public-evil players", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "merlin", "morgana", "loyal", "percival"],
      leaderIndex: 2,
      questIndex: 2,
      questResults: [{ teamIds: ["p1", "p3"], failCards: 2, succeeded: false }]
    });
    state = proposeTeam(state, "p3", ["p1", "p2"]);
    state = finishDiscussion(state);

    const prompt = buildAIPrompt({
      state,
      playerId: "p4",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p4", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("PF hardGood=p2,p4,p5 hardEvil=p1,p3");
    expect(prompt).toContain("pr=p3>p1+p2");
    expect(prompt).not.toContain("GOOD vote current=");
    expect(prompt).not.toContain("=> reject/no");
  });

  it("does not prescribe evil voter choices for all-public-good teams", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "merlin", "morgana", "loyal", "percival"],
      leaderIndex: 3,
      questIndex: 2,
      questResults: [{ teamIds: ["p1", "p3"], failCards: 2, succeeded: false }]
    });
    state = proposeTeam(state, "p4", ["p2", "p4"]);
    state = finishDiscussion(state);

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("PF hardGood=p2,p4,p5 hardEvil=p1,p3");
    expect(prompt).toContain("pr=p4>p2+p4");
    expect(prompt).not.toContain("EV vote current=");
    expect(prompt).not.toContain("non-pivotal camouflage");
  });

  it("does not warn evil proposal leaders into a fixed all-known-good avoidance strategy", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      leaderIndex: 2,
      questIndex: 1,
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "proposeTeam",
      legalActions: [{ type: "proposeTeam", teamIds: ["p1", "p4", "p5"] }],
      persona: createPersona("p3", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("ME p3@3 morgana evil");
    expect(prompt).toContain("KE=p2");
    expect(prompt).not.toContain("EV private action check");
    expect(prompt).not.toContain("EV pt/v precheck");
    expect(prompt).not.toContain("EV pt chooser");
    expect(prompt).not.toContain("do not propose all-public-good/off-slot teams");
    expect(prompt).not.toContain("sabotage-capable");
    expect(prompt).not.toContain("p1,p4,p5 are good");
  });

  it("keeps the all-public-good team check generic instead of hard-coding the current seats", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      leaderIndex: 2,
      questIndex: 1,
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "proposeTeam",
      legalActions: [
        { type: "proposeTeam", teamIds: ["p1", "p4", "p5"] },
        { type: "proposeTeam", teamIds: ["p1", "p3", "p4"] },
        { type: "proposeTeam", teamIds: ["p2", "p3", "p4"] }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("CHECK before JSON: use PF hardGood/hardEvil as 100% facts; everything else is SOFT_READ unless LG proves it");
    expect(prompt).not.toContain("EV public-fact check");
    expect(prompt).not.toContain("camouflage-approve");
    expect(prompt).not.toContain("p1,p4,p5 are good");
    expect(prompt).not.toContain("p2,p3 are evil");
  });

  it("shows proposal leaders legal teams without categorizing strategy keep and avoid sets", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      leaderIndex: 2,
      questIndex: 1,
      questResults: [{ teamIds: ["p2", "p3"], failCards: 2, succeeded: false }]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "proposeTeam",
      legalActions: [
        { type: "proposeTeam", teamIds: ["p1", "p4", "p5"] },
        { type: "proposeTeam", teamIds: ["p1", "p3", "p4"] },
        { type: "proposeTeam", teamIds: ["p2", "p3", "p4"] }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("LA pt n=3 teams=p1+p4+p5|p1+p3+p4|p2+p3+p4");
    expect(prompt).toContain("p1+p3+p4");
    expect(prompt).toContain("p2+p3+p4");
    expect(prompt).not.toContain("EV legal keep=");
    expect(prompt).not.toContain("avoid=p1+p4+p5");
    expect(prompt).not.toContain("p1,p4,p5 are good");
  });

  it("lists legal complete proposal teams instead of only candidate ids", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "assassin", "morgana", "loyal", "percival"],
      leaderIndex: 2,
      questIndex: 1
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "proposeTeam",
      legalActions: [
        { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] },
        { type: "proposeTeam", teamIds: ["p1", "p3", "p4"] },
        { type: "proposeTeam", teamIds: ["p2", "p3", "p5"] }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("LA pt n=3 teams=p1+p2+p3|p1+p3+p4|p2+p3+p5");
    expect(prompt).toContain("PT choose listed complete team; len(ids)=n");
    expect(prompt).not.toContain("LA pt n=3 ids=");
  });

  it("tells assassins to choose exactly one legal target id instead of a team string", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "morgana", "loyal", "merlin", "percival"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p3", "p4"], failCards: 0, succeeded: true },
        { teamIds: ["p3", "p4", "p5"], failCards: 0, succeeded: true },
        { teamIds: ["p3", "p5"], failCards: 0, succeeded: true }
      ]
    });

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "assassinate",
      legalActions: [
        { type: "assassinate", targetId: "p3" },
        { type: "assassinate", targetId: "p4" },
        { type: "assassinate", targetId: "p5" }
      ],
      persona: createPersona("p1", 5),
      reasoningEffort: "low",
      language: "zh"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("LA as ids=p3,p4,p5");
    expect(prompt).toContain("AS choose one id from LA as ids; never output a list/team/comma string");
    expect(prompt).toContain("OUT JSON keys=s,a a={\"t\":\"as\",\"id\":\"pX\"} one target only");
  });

  it("does not tell evil voters to reject current proposals that contain no known evil path", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["morgana", "loyal", "assassin", "percival", "merlin"],
      leaderIndex: 1,
      questIndex: 1,
      questResults: [{ teamIds: ["p1", "p3"], failCards: 2, succeeded: false }]
    });
    state = proposeTeam(state, "p2", ["p2", "p4", "p5"]);
    state = finishDiscussion(state);

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("ME p1@1 morgana evil");
    expect(prompt).toContain("KE=p3");
    expect(prompt).toContain("pr=p2>p2+p4+p5");
    expect(prompt).not.toContain("EV vote current=");
    expect(prompt).not.toContain("lacks ME/KE => reject/no");
  });

  it("does not give evil voters a private mission-path precheck before any quest has failed", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "loyal", "assassin", "percival", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p2"]);
    state = finishDiscussion(state);

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p3", 5),
      reasoningEffort: "low"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("ME p3@3 assassin evil");
    expect(prompt).toContain("KE=p5");
    expect(prompt).toContain("pr=p1>p1+p2");
    expect(prompt).not.toContain("EV vote current=");
    expect(prompt).not.toContain("lacks ME/KE => reject/no");
    expect(prompt).not.toContain("PF hardGood=");
  });
});

describe("AI prompt public vote information", () => {
  it("hides individual votes until every player has voted", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p2"]);
    state = finishDiscussion(state);
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
    state = finishDiscussion(state);
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

    expect(prompt).toContain("QC=1/2:*");
    expect(prompt).not.toContain("p1:success");
  });

  it("summarizes revealed approve and reject votes accurately after voting resolves", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p2"]);
    state = finishDiscussion(state);
    state = castVote(state, "p1", true);
    state = castVote(state, "p2", true);
    state = castVote(state, "p3", false);
    state = castVote(state, "p4", false);
    state = castVote(state, "p5", true);

    const prompt = buildAIPrompt({
      state,
      playerId: "p1",
      actionKind: "quest",
      legalActions: [{ type: "quest", card: "success" }],
      persona: createPersona("p1", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("V=p1:A,p2:A,p3:R,p4:R,p5:A");
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

    expect(prompt).toContain("TT o>n");
    expect(prompt).toContain("TT soft public claims only; use speaker claims for pressure, not truth");
    expect(prompt).toContain("1|p1|I trust p2 first.");
    expect(prompt).toContain("2|p2|That trust came too early.");
    expect(prompt).not.toContain("|AI 1|");
  });

  it("bounds each table talk row while preserving chronological row labels", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    const longSpeech = `opening read ${"steady ".repeat(40)}tail-marker`;

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      tableTalk: [
        { id: 1, speakerId: "p1", speakerName: "AI 1", text: longSpeech },
        { id: 2, speakerId: "p2", speakerName: "AI 2", text: "second line\nkeeps order" }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    const talkRows = prompt.split("\n").filter((line) => /^\d+\|p\d+\|/u.test(line));
    expect(talkRows).toHaveLength(2);
    expect(talkRows[0]).toMatch(/^1\|p1\|opening read/u);
    expect(talkRows[0]).not.toContain("tail-marker");
    expect(talkRows[0].length).toBeLessThanOrEqual(189);
    expect(talkRows[1]).toBe("2|p2|second line keeps order");
  });

  it("prompts ordered discussion speakers with prior speeches before voting", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"]
    });
    state = proposeTeam(state, "p1", ["p1", "p2"]);

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      tableTalk: [
        { id: 1, speakerId: "p1", speakerName: "AI 1", text: "I picked a low-risk opener." },
        { id: 2, speakerId: "p2", speakerName: "AI 2", text: "I want p1 to explain the self-pick." }
      ],
      persona: createPersona("p3", 5),
      reasoningEffort: "medium"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("A=sp R=m:");
    expect(prompt).toContain("D next=p1 spoken=- order=p1,p2,p3,p4,p5");
    expect(prompt).toContain("TT o>n");
    expect(prompt).toContain("TT soft public claims only; use speaker claims for pressure, not truth");
    expect(prompt).toContain("1|p1|I picked a low-risk opener.");
    expect(prompt).toContain("2|p2|I want p1 to explain the self-pick.");
    expect(prompt).toContain("OUT JSON keys=s,a a={\"t\":\"sp\"}");
  });

  it("tells proposal leaders to explain the exact current proposal during their discussion turn", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      leaderIndex: 2,
      questIndex: 2
    });
    state = proposeTeam(state, "p3", ["p2", "p4"]);

    const prompt = buildAIPrompt({
      state,
      playerId: "p3",
      actionKind: "speak",
      legalActions: [{ type: "speak" }],
      persona: createPersona("p3", 5),
      reasoningEffort: "low",
      language: "zh"
    }).messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("G ph=discussion q=3");
    expect(prompt).toContain("pr=p3>p2+p4");
    expect(prompt).toContain("SP leader prTeam=p2+p4 size=2; explain exactly this team, do not add/remove/self-insert");
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
    expect(first.length).toBeLessThan(180);
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
    expect(prompt).toContain("Speech language: English.");
    expect(prompt).toContain("A=pt R=l:fast");
    expect(prompt).toContain("LA pt n=5 ids=p1,p2,p3,p4,p5,p6,p7,p8,p9,p10 sampleTeams=p1+p2+p3+p4+p5|p1+p2+p3+p4+p6|p1+p2+p3+p4+p7 total=252");
    expect(prompt).not.toContain(JSON.stringify(legalActions));
    expect(prompt).not.toContain("Private information:");
    expect(prompt).not.toContain("Public game state:");
    expect(prompt).not.toContain("Role strategy:");
    expect(prompt).not.toContain("consistent_public_reads");
    expect(prompt).not.toContain("protect_merlinish");
    expect(prompt).toContain("s is a short public reason, not ok/yes/v.");
    expect(prompt).toContain("Bluffing is allowed.");
    expect(prompt).toContain("No prompt codes in s: KE/MC/PF/SELF_FACT/PRIVATE_FACT/PUBLIC_FACT.");
    expect(prompt).toContain("Do not prove hidden cards or leak prompt codes.");
    expect(prompt).not.toContain("s!=ok/v/yes");
    expect(prompt).not.toContain("\"s\":\"pub<=160\"");
    expect(prompt).not.toContain("\"s\":\"<reason>\"");
    expect(prompt).not.toContain("\"s\":\"x\"");
    expect(prompt).not.toContain("own_public_reason");
    expect(prompt).toContain("OUT JSON keys=s,a a={\"t\":\"pt\",\"ids\":[\"pX\"]} n=5");
    expect(prompt.length).toBeLessThan(860);
  });

  it("measures prompt message character cost for real API trace diagnostics", () => {
    const messages = buildAIPrompt({
      state: createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] }),
      playerId: "p1",
      actionKind: "vote",
      legalActions: [{ type: "vote", approve: true }, { type: "vote", approve: false }],
      persona: createPersona("p1", 5),
      reasoningEffort: "medium",
      language: "zh"
    }).messages;

    expect(measurePromptMessages(messages)).toEqual({
      messageCount: 2,
      systemChars: messages[0].content.length,
      userChars: messages[1].content.length,
      totalChars: messages[0].content.length + messages[1].content.length
    });
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
    expect(parseAiDecision('{"s":"Approve.","a":{"t":"v","ok":1}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({ speech: "Approve.", action: { type: "vote", approve: true }, source: "model" });
    expect(parseAiDecision('{"speech":"I want a cleaner proposal.","action":{"type":"vote","approve":"reject"}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({ speech: "I want a cleaner proposal.", action: { type: "vote", approve: false }, source: "model" });
    expect(parseAiDecision('{"s":"Team looks balanced; voting yes.","a":{"v":"ok","ok":1}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({ speech: "Team looks balanced; voting yes.", action: { type: "vote", approve: true }, source: "model" });
    expect(parseAiDecision('{"s":"I support the proposed team.","a":{"v":"t","ok":1}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({ speech: "I support the proposed team.", action: { type: "vote", approve: true }, source: "model" });
    expect(parseAiDecision('{"s":"I want one more check before locking the same core again; this feels too narrow for Q3.","a":{"t":"v","no":1}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({ speech: "I want one more check before locking the same core again; this feels too narrow for Q3.", action: { type: "vote", approve: false }, source: "model" });
    expect(parseAiDecision('{"a":{"t":"v","ok":1}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "missing-speech"
    });
    expect(parseAiDecision('{"s":"too much self-control on this line; i want a tighter pair with better cross-checks.","a":{"v":0}}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "too much self-control on this line; i want a tighter pair with better cross-checks.",
      action: { type: "vote", approve: false },
      source: "model"
    });
    expect(parseAiDecision('{"s":"fits public signal","a":1}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    })).toEqual({
      speech: "fits public signal",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"This line is too risky to approve.","a":"0"}', legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "This line is too risky to approve.",
      action: { type: "vote", approve: false },
      source: "model"
    });

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

  it("accepts speech-only JSON only when exactly one legal action exists", () => {
    expect(parseAiDecision('{"s":"q success"}', [{ type: "quest", card: "success" }], {
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" }
    })).toEqual({
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" },
      source: "model",
      speechRepairReason: "quest-card-speech"
    });

    expect(parseAiDecision('{"s":"I am good with this."}', [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }], {
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" }
    })).toEqual({
      speech: "Fallback quest speech.",
      action: { type: "quest", card: "success" },
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "invalid-decision-shape"
    });
  });

  it("prefers nested compact speech when the top-level speech is an instruction summary", () => {
    expect(parseAiDecision('{"s":"中文简短发言，保留当前组但强调需要更多验证，给出备选组思路。","a":{"t":"sp","text":"我同意先别把这组直接定死，但我不想只盯着 p1+p3。当前信息还不够稳，我更倾向先看一组备选。"}}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    })).toEqual({
      speech: "我同意先别把这组直接定死，但我不想只盯着 p1+p3。当前信息还不够稳，我更倾向先看一组备选。",
      action: { type: "speak" },
      source: "model",
      speechRepairReason: "nested-speech"
    });
  });

  it("uses the only legal action when compact action noise accompanies usable speech", () => {
    expect(parseAiDecision('{"s":"这队我先通过，后续看发言和投票反馈。","a":"approve"}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    })).toEqual({
      speech: "这队我先通过，后续看发言和投票反馈。",
      action: { type: "speak" },
      source: "model",
      speechRepairReason: "forced-legal-action"
    });
  });

  it("preserves speech from root compact speak actions", () => {
    expect(parseAiDecision('{"t":"sp","s":"我先支持 p1+p4 这队，人数简单，后面也方便继续对照发言。"}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    })).toEqual({
      speech: "我先支持 p1+p4 这队，人数简单，后面也方便继续对照发言。",
      action: { type: "speak" },
      source: "model"
    });
  });

  it("accepts a compact decision wrapped in an out envelope", () => {
    expect(parseAiDecision('{"out":{"t":"sp","s":"先沿用当前提案，继续观察发言和站队。"}}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    })).toEqual({
      speech: "先沿用当前提案，继续观察发言和站队。",
      action: { type: "speak" },
      source: "model"
    });
  });

  it("uses the first compact action candidate when the model returns an action list", () => {
    expect(parseAiDecision('{"s":"先保自己上车，再搭配一名相对稳的队友。","a":[{"t":"pt","ids":["p1","p3"]},{"t":"pt","ids":["p1","p4"]}]}', [
      { type: "proposeTeam", teamIds: ["p1", "p3"] },
      { type: "proposeTeam", teamIds: ["p1", "p4"] }
    ], {
      speech: "我先提一个清晰、容易检验的队伍。",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({
      speech: "先保自己上车，再搭配一名相对稳的队友。",
      action: { type: "proposeTeam", teamIds: ["p1", "p3"] },
      source: "model"
    });
  });

  it("repairs unsafe public speech while keeping legal model actions", () => {
    const fallback = { speech: "Safe fallback speech.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision('{"s":"p1 and p4 both still read as plausible Merlin material.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "p1 and p4 both still read as plausible Merlin material.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"cover MC without showing too much","a":{"t":"pt","ids":["p1","p2"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2"] }], {
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] },
      source: "model",
      speechRepairReason: "unsafe-role-word"
    });
    expect(parseAiDecision('{"s":"SELF_FACT says I am good, so this is safe.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "unsafe-role-word"
    });
    expect(parseAiDecision('{"s":"优先带上更可疑的成员，保留破坏空间。","a":{"t":"pt","ids":["p3","p5"]}}', [{ type: "proposeTeam", teamIds: ["p3", "p5"] }], {
      speech: "我先提一个清晰、容易检验的队伍。",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({
      speech: "我提议 p3+p5，先做一个清晰检验。",
      action: { type: "proposeTeam", teamIds: ["p3", "p5"] },
      source: "model",
      speechRepairReason: "secret-intent-leak"
    });
    expect(parseAiDecision('{"s":"含至少一个可破坏位","a":{"t":"pt","ids":["p2","p3","p4"]}}', [{ type: "proposeTeam", teamIds: ["p2", "p3", "p4"] }], {
      speech: "我先提一个清晰、容易检验的队伍。",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }
    })).toEqual({
      speech: "我提议 p2+p3+p4，先做一个清晰检验。",
      action: { type: "proposeTeam", teamIds: ["p2", "p3", "p4"] },
      source: "model",
      speechRepairReason: "secret-intent-leak"
    });
    expect(parseAiDecision('{"s":"提案含可破坏位，保留作恶能力。","a":{"t":"pt","ids":["p2","p3","p4"]}}', [{ type: "proposeTeam", teamIds: ["p2", "p3", "p4"] }], {
      speech: "我先提一个清晰、容易检验的队伍。",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }
    })).toEqual({
      speech: "我提议 p2+p3+p4，先做一个清晰检验。",
      action: { type: "proposeTeam", teamIds: ["p2", "p3", "p4"] },
      source: "model",
      speechRepairReason: "secret-intent-leak"
    });
    expect(parseAiDecision('{"s":"队伍里有可操作位，先过。","a":{"t":"v","ok":1}}', legalVotes, {
      speech: "我想先看一个更干净的提案。",
      action: { type: "vote", approve: false }
    })).toEqual({
      speech: "这队目前可以接受。",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "secret-intent-leak"
    });
    expect(parseAiDecision('{"s":"p2作恶阵营，提名队伍包含我，适合通过以争取优势。","a":{"t":"v","ok":1}}', legalVotes, {
      speech: "我想先看一个更干净的提案。",
      action: { type: "vote", approve: false }
    }, { playerId: "p2" })).toEqual({
      speech: "这队目前可以接受。",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "secret-intent-leak"
    });
    expect(parseAiDecision('{"s":"p2作恶阵营，提名队伍包含我，适合通过以争取优势。","a":{"t":"v","ok":0}}', legalVotes, {
      speech: "我想先看一个更干净的提案。",
      action: { type: "vote", approve: false }
    }, { playerId: "p4" })).toEqual({
      speech: "p2作恶阵营，提名队伍包含我，适合通过以争取优势。",
      action: { type: "vote", approve: false },
      source: "model"
    });
    expect(parseAiDecision('{"s":"我不是坏人，这队仍然要按公开结果讨论。","a":{"t":"v","ok":1}}', legalVotes, {
      speech: "我想先看一个更干净的提案。",
      action: { type: "vote", approve: false }
    }, { playerId: "p3" })).toEqual({
      speech: "我不是坏人，这队仍然要按公开结果讨论。",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"这队固定是 p1、p3、p5，已知 p3 明显偏恶，p5也高度可疑。","a":{"t":"sp"}}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    }, { playerId: "p3" })).toEqual({
      speech: "这队固定是 p1、p3、p5，已知 p3 明显偏恶，p5也高度可疑。",
      action: { type: "speak" },
      source: "model"
    });
    expect(parseAiDecision('{"s":"我担心 p3 会破坏任务，所以这轮要多听他说法。","a":{"t":"sp"}}', [{ type: "speak" }], {
      speech: "我先看队伍和前面发言的矛盾点。",
      action: { type: "speak" }
    })).toEqual({
      speech: "我担心 p3 会破坏任务，所以这轮要多听他说法。",
      action: { type: "speak" },
      source: "model"
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
    expect(parseAiDecision('{"s":"pub<=160","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"vote why","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"Vote yes.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "Vote yes.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Proceed with the vote.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "Proceed with the vote.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"I can back this.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"<reason>","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"own_public_reason","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"I like this test.","a":{"t":"pt","ids":["p1","p2"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2"] }], {
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] }
    })).toEqual({
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2"] },
      source: "model",
      speechRepairReason: "schema-echo"
    });
    expect(parseAiDecision('{"s":"v","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "v",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"p1,p2,p3","a":{"t":"pt","ids":["p1","p2","p3"]}}', [{ type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }], {
      speech: "Safe proposal speech.",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] }
    })).toEqual({
      speech: "p1,p2,p3",
      action: { type: "proposeTeam", teamIds: ["p1", "p2", "p3"] },
      source: "model"
    });
    expect(parseAiDecision('{"s":"同意。","a":{"t":"v","ok":1}}', legalVotes, {
      speech: "我想先看一个更干净的提案。",
      action: { type: "vote", approve: false }
    })).toEqual({
      speech: "同意。",
      action: { type: "vote", approve: true },
      source: "model"
    });
  });

  it("preserves overlong public speech instead of displaying an ellipsis", () => {
    const longSpeech = `Team has two prior outcomes: ${"clear public signal ".repeat(7)}so I can back this for now.`;

    const decision = parseAiDecision(JSON.stringify({ s: longSpeech, a: { t: "v", ok: 1 } }), legalVotes, {
      speech: "Fallback",
      action: { type: "vote", approve: false }
    });

    expect(decision).toMatchObject({
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(decision.speech).toBe(longSpeech);
    expect(decision.speech).not.toContain("...");
  });

  it("preserves legal model speech even when it appears to contradict the chosen vote action", () => {
    const fallback = { speech: "I want a cleaner proposal before approving.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision('{"s":"That lineup looks risky; I would avoid p3 here and prefer a cleaner mix.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "That lineup looks risky; I would avoid p3 here and prefer a cleaner mix.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"I would rather see more consistency before greenlighting this one.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "I would rather see more consistency before greenlighting this one.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"No. Self-plus-one first draft gives too much control; I want a cleaner split and more talk before I trust it.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "No. Self-plus-one first draft gives too much control; I want a cleaner split and more talk before I trust it.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Early pair is thin; I want one more round of pressure before giving a clean pass.","a":{"t":"v","ok":true}}', legalVotes, fallback)).toEqual({
      speech: "Early pair is thin; I want one more round of pressure before giving a clean pass.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"team looks light; I want one more round of pressure before locking.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "team looks light; I want one more round of pressure before locking.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Early vote keeps options open; I’m leaning yes to avoid overcommitting now.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "Early vote keeps options open; I’m leaning yes to avoid overcommitting now.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Approve: Q1 had no fails with p2+p4, and adding leader p3 is a reasonable low-change test. Rejecting feels like churn.","a":{"t":"v","ok":1}}', legalVotes, fallback)).toEqual({
      speech: "Approve: Q1 had no fails with p2+p4, and adding leader p3 is a reasonable low-change test. Rejecting feels like churn.",
      action: { type: "vote", approve: true },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Looks reasonable; voting yes.","a":{"t":"v","ok":false}}', legalVotes, {
      speech: "This team is acceptable for now.",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "Looks reasonable; voting yes.",
      action: { type: "vote", approve: false },
      source: "model"
    });
    expect(parseAiDecision('{"s":"Reject: Q1 failed on p1+p3; adding p1 back is unnecessary, and the quick approve cluster on p2/p4 does not lower risk.","a":{"t":"v","ok":0}}', legalVotes, fallback)).toEqual({
      speech: "Reject: Q1 failed on p1+p3; adding p1 back is unnecessary, and the quick approve cluster on p2/p4 does not lower risk.",
      action: { type: "vote", approve: false },
      source: "model"
    });
  });

  it("preserves proposal speech that names a different team than the selected legal proposal action", () => {
    const fallback = { speech: "我先提一个清晰、容易检验的队伍。", action: { type: "proposeTeam" as const, teamIds: ["p1", "p2", "p3"] } };

    expect(parseAiDecision(
      '{"s":"上一轮1、2里至少有一坏，先别把双嫌疑一起带；我倾向用3、4做底，再补5试一轮。","a":{"t":"pt","ids":["p1","p3","p5"]}}',
      [{ type: "proposeTeam", teamIds: ["p1", "p3", "p5"] }],
      fallback
    )).toEqual({
      speech: "上一轮1、2里至少有一坏，先别把双嫌疑一起带；我倾向用3、4做底，再补5试一轮。",
      action: { type: "proposeTeam", teamIds: ["p1", "p3", "p5"] },
      source: "model"
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

  it("accepts ordered discussion speech while still rejecting illegal speak actions", () => {
    const fallback = { speech: "我先看队伍和前面发言的矛盾点。", action: { type: "speak" as const } };

    expect(parseAiDecision('{"s":"我像梅林也好，不像也好，先看 p2 为什么急着过车。","a":{"t":"sp"}}', [{ type: "speak" }], fallback)).toEqual({
      speech: "我像梅林也好，不像也好，先看 p2 为什么急着过车。",
      action: { type: "speak" },
      source: "model"
    });
    expect(parseAiDecision('{"s":"I will talk first.","a":{"t":"sp"}}', [{ type: "vote", approve: true }], {
      speech: "Fallback",
      action: { type: "vote", approve: true }
    })).toEqual({
      speech: "Fallback",
      action: { type: "vote", approve: true },
      source: "fallback",
      fallbackReason: "illegal-action",
      fallbackDetail: "illegal-action"
    });
  });

  it("falls back when JSON is malformed or the action is illegal", () => {
    const fallback = { speech: "No legal model action. Rejecting.", action: { type: "vote" as const, approve: false } };

    expect(parseAiDecision("not json", legalVotes, fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "no-json-object"
    });
    expect(parseAiDecision("{bad}", legalVotes, fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "malformed-json"
    });
    expect(parseAiDecision('{"speech":"Skip","action":{"type":"vote","approve":"maybe"}}', legalVotes, fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "invalid-json",
      fallbackDetail: "invalid-decision-shape"
    });
    expect(parseAiDecision('{"speech":"Illegal","action":{"type":"vote","approve":true}}', [{ type: "vote", approve: false }], fallback)).toEqual({
      ...fallback,
      source: "fallback",
      fallbackReason: "illegal-action",
      fallbackDetail: "illegal-action"
    });
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
