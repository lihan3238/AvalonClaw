import { createInitialGame, proposeTeam, castVote, submitQuestCard } from "./rules";
import { getLegalActionsForPlayer } from "./legalActions";

describe("legal action generation", () => {
  it("generates exact-size proposal teams", () => {
    const state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    const actions = getLegalActionsForPlayer(state, "p1", "proposeTeam");

    expect(actions).toContainEqual({ type: "proposeTeam", teamIds: ["p1", "p2"] });
    expect(actions).toHaveLength(10);
  });

  it("only lets the current leader generate proposal actions during proposal phase", () => {
    let state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

    expect(() => getLegalActionsForPlayer(state, "p2", "proposeTeam")).toThrow(/not the current leader/i);

    state = proposeTeam(state, "p1", ["p1", "p2"]);
    expect(() => getLegalActionsForPlayer(state, "p1", "proposeTeam")).toThrow(/proposal phase/i);
  });

  it("only lets unvoted players generate vote actions during voting phase", () => {
    let state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

    expect(() => getLegalActionsForPlayer(state, "p1", "vote")).toThrow(/voting phase/i);

    state = proposeTeam(state, "p1", ["p1", "p2"]);
    expect(getLegalActionsForPlayer(state, "p1", "vote")).toEqual([{ type: "vote", approve: true }, { type: "vote", approve: false }]);
    state = castVote(state, "p1", true);
    expect(() => getLegalActionsForPlayer(state, "p1", "vote")).toThrow(/already voted/i);
    state = castVote(state, "p2", false);
    expect(() => getLegalActionsForPlayer(state, "p2", "vote")).toThrow(/already voted/i);
  });

  it("limits quest cards by allegiance", () => {
    let state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    state = proposeTeam(state, "p1", ["p1", "p4"]);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }

    expect(getLegalActionsForPlayer(state, "p1", "quest")).toEqual([{ type: "quest", card: "success" }]);
    expect(getLegalActionsForPlayer(state, "p4", "quest")).toEqual([{ type: "quest", card: "success" }, { type: "quest", card: "fail" }]);
    expect(() => getLegalActionsForPlayer(state, "p2", "quest")).toThrow(/not on the current quest team/i);
    state = submitQuestCard(state, "p1", "success");
    expect(() => getLegalActionsForPlayer(state, "p1", "quest")).toThrow(/already submitted/i);
  });

  it("lets Assassin target good players only during assassination", () => {
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
    const premature = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination"
    });

    expect(getLegalActionsForPlayer(state, "p4", "assassinate")).toEqual([
      { type: "assassinate", targetId: "p1" },
      { type: "assassinate", targetId: "p2" },
      { type: "assassinate", targetId: "p3" }
    ]);
    expect(() => getLegalActionsForPlayer(state, "p1", "assassinate")).toThrow(/only the Assassin/i);
    expect(() => getLegalActionsForPlayer(premature, "p4", "assassinate")).toThrow(/three successful quests/i);
  });
});
