import { createInitialGame, proposeTeam, advanceDiscussionTurn, castVote } from "./rules";
import { redactGameForSeat } from "./multiplayerView";

describe("multiplayer redacted views", () => {
  const roles = ["merlin", "percival", "loyal", "assassin", "morgana"] as const;

  it("hides other players' roles and allegiances before game over", () => {
    const state = createInitialGame({ playerCount: 5, humanSeat: 0, roles: [...roles] });

    const view = redactGameForSeat(state, 2);

    expect(view.game.humanSeat).toBe(2);
    expect(view.game.players[2].role).toBe("loyal");
    for (const seat of [0, 1, 3, 4]) {
      expect(view.game.players[seat].role).toBe("loyal");
      expect(view.game.players[seat].allegiance).toBe("good");
    }
  });

  it("keeps the viewer's own role and role knowledge", () => {
    const state = createInitialGame({ playerCount: 5, humanSeat: 0, roles: [...roles] });

    const merlinView = redactGameForSeat(state, 0);
    expect(merlinView.game.players[0].role).toBe("merlin");
    expect(merlinView.knowledge.knownEvilIds).toEqual(["p4", "p5"]);

    const assassinView = redactGameForSeat(state, 3);
    expect(assassinView.game.players[3].role).toBe("assassin");
    expect(assassinView.knowledge.knownEvilIds).toEqual(["p5"]);
  });

  it("hides unresolved vote values except the viewer's own", () => {
    let state = createInitialGame({ playerCount: 5, humanSeat: 0, roles: [...roles] });
    state = proposeTeam(state, "p1", ["p1", "p2"]);
    while (state.phase === "discussion") {
      state = advanceDiscussionTurn(state, state.players[state.discussion!.nextSpeakerIndex].id);
    }
    state = castVote(state, "p1", false);
    state = castVote(state, "p2", true);

    const view = redactGameForSeat(state, 0);
    expect(view.game.votes.p1).toBe("reject");
    expect(view.game.votes.p2).toBe("approve");

    const otherView = redactGameForSeat(state, 2);
    expect(otherView.game.votes.p1).toBe("approve");
    expect(Object.keys(otherView.game.votes)).toEqual(["p1", "p2"]);
  });

  it("never attributes other players' quest cards", () => {
    let state = createInitialGame({ playerCount: 5, humanSeat: 0, roles: [...roles] });
    state = proposeTeam(state, "p1", ["p4", "p5"]);
    while (state.phase === "discussion") {
      state = advanceDiscussionTurn(state, state.players[state.discussion!.nextSpeakerIndex].id);
    }
    for (const player of state.players) {
      state = castVote(state, player.id, true);
    }
    state = { ...state, questCards: { p4: "fail" } };

    const view = redactGameForSeat(state, 0);
    expect(view.game.questCards.p4).toBe("success");

    const submitterView = redactGameForSeat(state, 3);
    expect(submitterView.game.questCards.p4).toBe("fail");
  });

  it("reveals all roles at game over", () => {
    const state = createInitialGame({ playerCount: 5, humanSeat: 0, roles: [...roles], phase: "gameOver" });
    state.winner = "good";
    state.winReason = "questSuccesses";

    const view = redactGameForSeat(state, 2);
    expect(view.game.players[0].role).toBe("merlin");
    expect(view.game.players[3].role).toBe("assassin");
  });
});
