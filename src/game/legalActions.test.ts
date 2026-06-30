import { createInitialGame, proposeTeam, castVote } from "./rules";
import { getLegalActionsForPlayer } from "./legalActions";

describe("legal action generation", () => {
  it("generates exact-size proposal teams", () => {
    const state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    const actions = getLegalActionsForPlayer(state, "p1", "proposeTeam");

    expect(actions).toContainEqual({ type: "proposeTeam", teamIds: ["p1", "p2"] });
    expect(actions).toHaveLength(10);
  });

  it("limits quest cards by allegiance", () => {
    let state = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    state = proposeTeam(state, "p1", ["p1", "p4"]);
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }

    expect(getLegalActionsForPlayer(state, "p1", "quest")).toEqual([{ type: "quest", card: "success" }]);
    expect(getLegalActionsForPlayer(state, "p4", "quest")).toEqual([{ type: "quest", card: "success" }, { type: "quest", card: "fail" }]);
  });

  it("lets Assassin target any other player during assassination", () => {
    const state = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination"
    });

    expect(getLegalActionsForPlayer(state, "p4", "assassinate")).toEqual([
      { type: "assassinate", targetId: "p1" },
      { type: "assassinate", targetId: "p2" },
      { type: "assassinate", targetId: "p3" },
      { type: "assassinate", targetId: "p5" }
    ]);
  });
});
