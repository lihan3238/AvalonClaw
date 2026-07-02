import { advanceDiscussionTurn, createInitialGame, proposeTeam, castVote } from "../game/rules";
import { chooseFallbackDecision } from "./fallback";

describe("AI fallback decisions", () => {
  it("proposes an exact-size legal team that includes the leader", () => {
    const state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    const decision = chooseFallbackDecision(state, "p1", "proposeTeam");

    expect(decision.action).toEqual({ type: "proposeTeam", teamIds: ["p1", "p2"] });
  });

  it("never lets a good player fail a quest", () => {
    let state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    state = proposeTeam(state, "p1", ["p1", "p4"]);
    state = finishDiscussion(state);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }

    expect(chooseFallbackDecision(state, "p1", "quest").action).toEqual({ type: "quest", card: "success" });
    expect(chooseFallbackDecision(state, "p4", "quest").action).toEqual({ type: "quest", card: "fail" });
  });

  it("assassin fallback targets a plausible non-evil Merlin candidate", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3", "p4"], failCards: 0, succeeded: true },
        { teamIds: ["p2", "p3"], failCards: 0, succeeded: true }
      ]
    });

    expect(chooseFallbackDecision(state, "p4", "assassinate").action).toEqual({ type: "assassinate", targetId: "p1" });
  });

  it("assassin fallback uses public quest evidence instead of omniscient role knowledge", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["morgana", "assassin", "merlin", "loyal", "percival"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p3", "p5"], failCards: 0, succeeded: true },
        { teamIds: ["p4", "p5", "p1"], failCards: 0, succeeded: true },
        { teamIds: ["p2", "p5"], failCards: 0, succeeded: true }
      ]
    });

    expect(chooseFallbackDecision(state, "p2", "assassinate").action).toEqual({ type: "assassinate", targetId: "p5" });
  });

  it("assassin fallback never targets hidden evil players", () => {
    const state = createInitialGame({
      playerCount: 10,
      roles: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred", "oberon"],
      phase: "assassination",
      questResults: [
        { teamIds: ["p10", "p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p10", "p3", "p4", "p5"], failCards: 0, succeeded: true },
        { teamIds: ["p10", "p6", "p1", "p2"], failCards: 0, succeeded: true }
      ]
    });

    const action = chooseFallbackDecision(state, "p7", "assassinate").action;
    if (action.type !== "assassinate") {
      throw new Error("Expected assassination fallback action");
    }
    expect(state.players.find((player) => player.id === action.targetId)?.allegiance).toBe("good");
  });

  it("has Merlin avoid known evil players when proposing a team", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "loyal", "merlin", "morgana", "percival"],
      leaderIndex: 2
    });

    expect(chooseFallbackDecision(state, "p3", "proposeTeam").action).toEqual({ type: "proposeTeam", teamIds: ["p3", "p2"] });
  });

  it("has good leaders avoid repeating players from failed quests when proposing", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["morgana", "percival", "loyal", "merlin", "assassin"],
      leaderIndex: 1,
      questIndex: 1,
      questResults: [{ teamIds: ["p1", "p2"], failCards: 1, succeeded: false }]
    });

    expect(chooseFallbackDecision(state, "p2", "proposeTeam").action).toEqual({ type: "proposeTeam", teamIds: ["p2", "p3", "p4"] });
  });

  it("has Merlin reject teams containing known evil players", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "loyal", "merlin", "morgana", "percival"],
      leaderIndex: 2
    });
    state = proposeTeam(state, "p3", ["p3", "p1"]);
    state = finishDiscussion(state);

    expect(chooseFallbackDecision(state, "p3", "vote").action).toEqual({ type: "vote", approve: false });
  });

  it("lets a lone evil player hide on two-fail quests instead of wasting a fail card", () => {
    let state = createInitialGame({
      playerCount: 7,
      roles: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
      questIndex: 3
    });
    state = proposeTeam(state, "p1", ["p1", "p2", "p3", "p5"]);
    state = finishDiscussion(state);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }

    expect(chooseFallbackDecision(state, "p5", "quest").action).toEqual({ type: "quest", card: "success" });
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
