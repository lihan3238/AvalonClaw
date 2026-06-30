import { createInitialGame, proposeTeam, castVote } from "../game/rules";
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
      phase: "assassination"
    });

    expect(chooseFallbackDecision(state, "p4", "assassinate").action).toEqual({ type: "assassinate", targetId: "p1" });
  });

  it("has Merlin avoid known evil players when proposing a team", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "loyal", "merlin", "morgana", "percival"],
      leaderIndex: 2
    });

    expect(chooseFallbackDecision(state, "p3", "proposeTeam").action).toEqual({ type: "proposeTeam", teamIds: ["p3", "p2"] });
  });

  it("has Merlin reject teams containing known evil players", () => {
    let state = createInitialGame({
      playerCount: 5,
      roles: ["assassin", "loyal", "merlin", "morgana", "percival"],
      leaderIndex: 2
    });
    state = proposeTeam(state, "p3", ["p3", "p1"]);

    expect(chooseFallbackDecision(state, "p3", "vote").action).toEqual({ type: "vote", approve: false });
  });

  it("lets a lone evil player hide on two-fail quests instead of wasting a fail card", () => {
    let state = createInitialGame({
      playerCount: 7,
      roles: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
      questIndex: 3
    });
    state = proposeTeam(state, "p1", ["p1", "p2", "p3", "p5"]);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }

    expect(chooseFallbackDecision(state, "p5", "quest").action).toEqual({ type: "quest", card: "success" });
  });
});
