import {
  assassinateMerlin,
  castVote,
  createInitialGame,
  getDefaultRoles,
  getQuestConfig,
  getRoleKnowledge,
  proposeTeam,
  submitQuestCard
} from "./rules";

describe("Avalon rule tables", () => {
  it("uses official quest team sizes and fail thresholds", () => {
    expect(getQuestConfig(5)).toEqual([
      { teamSize: 2, failsRequired: 1 },
      { teamSize: 3, failsRequired: 1 },
      { teamSize: 2, failsRequired: 1 },
      { teamSize: 3, failsRequired: 1 },
      { teamSize: 3, failsRequired: 1 }
    ]);

    expect(getQuestConfig(7)).toEqual([
      { teamSize: 2, failsRequired: 1 },
      { teamSize: 3, failsRequired: 1 },
      { teamSize: 3, failsRequired: 1 },
      { teamSize: 4, failsRequired: 2 },
      { teamSize: 4, failsRequired: 1 }
    ]);

    expect(getQuestConfig(10)).toEqual([
      { teamSize: 3, failsRequired: 1 },
      { teamSize: 4, failsRequired: 1 },
      { teamSize: 4, failsRequired: 1 },
      { teamSize: 5, failsRequired: 2 },
      { teamSize: 5, failsRequired: 1 }
    ]);
  });

  it("creates default role lineups with the correct good and evil counts", () => {
    expect(getDefaultRoles(5)).toHaveLength(5);
    expect(getDefaultRoles(5).filter((role) => role.allegiance === "good")).toHaveLength(3);
    expect(getDefaultRoles(5).filter((role) => role.allegiance === "evil")).toHaveLength(2);

    expect(getDefaultRoles(7).filter((role) => role.allegiance === "good")).toHaveLength(4);
    expect(getDefaultRoles(7).filter((role) => role.allegiance === "evil")).toHaveLength(3);

    expect(getDefaultRoles(10).filter((role) => role.allegiance === "good")).toHaveLength(6);
    expect(getDefaultRoles(10).filter((role) => role.allegiance === "evil")).toHaveLength(4);
  });
});

describe("role knowledge", () => {
  const game = createInitialGame({
    playerCount: 7,
    humanSeat: 0,
    roles: ["merlin", "percival", "loyal", "assassin", "morgana", "mordred", "oberon"]
  });

  it("lets Merlin see evil players except Mordred", () => {
    const knowledge = getRoleKnowledge(game, "p1");

    expect(knowledge.knownEvilIds).toEqual(["p4", "p5", "p7"]);
    expect(knowledge.merlinCandidateIds).toEqual([]);
  });

  it("lets Percival see Merlin and Morgana as ambiguous candidates", () => {
    const knowledge = getRoleKnowledge(game, "p2");

    expect(knowledge.knownEvilIds).toEqual([]);
    expect(knowledge.merlinCandidateIds).toEqual(["p1", "p5"]);
  });

  it("hides Oberon from evil teammates and gives Oberon no team knowledge", () => {
    expect(getRoleKnowledge(game, "p4").knownEvilIds).toEqual(["p5", "p6"]);
    expect(getRoleKnowledge(game, "p7").knownEvilIds).toEqual([]);
  });
});

describe("proposal and voting", () => {
  it("requires exact quest team size", () => {
    const game = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

    expect(() => proposeTeam(game, "p1", ["p1"])).toThrow(/requires 2 players/i);
    expect(proposeTeam(game, "p1", ["p1", "p2"]).phase).toBe("voting");
  });

  it("approves only strict majorities and advances to quest phase", () => {
    let game = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    game = proposeTeam(game, "p1", ["p1", "p2"]);
    game = castVote(game, "p1", true);
    game = castVote(game, "p2", true);
    game = castVote(game, "p3", false);
    game = castVote(game, "p4", false);
    game = castVote(game, "p5", true);

    expect(game.phase).toBe("quest");
    expect(game.failedVotes).toBe(0);
  });

  it("gives evil the game after five rejected proposals", () => {
    let game = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leader = game.players[game.leaderIndex].id;
      game = proposeTeam(game, leader, [leader, game.players[(game.leaderIndex + 1) % game.players.length].id]);
      for (const player of game.players) {
        game = castVote(game, player.id, false);
      }
    }

    expect(game.phase).toBe("gameOver");
    expect(game.winner).toBe("evil");
    expect(game.winReason).toBe("voteTrack");
  });
});

describe("quest and assassination resolution", () => {
  it("fails a normal quest with one fail card", () => {
    let game = createInitialGame({ playerCount: 5, roles: ["merlin", "percival", "loyal", "assassin", "morgana"] });
    game = proposeTeam(game, "p1", ["p1", "p4"]);
    for (const player of game.players) {
      game = castVote(game, player.id, true);
    }
    game = submitQuestCard(game, "p1", "success");
    game = submitQuestCard(game, "p4", "fail");

    expect(game.questResults).toEqual([{ teamIds: ["p1", "p4"], failCards: 1, succeeded: false }]);
    expect(game.phase).toBe("proposal");
    expect(game.questIndex).toBe(1);
  });

  it("requires two fail cards on quest four in 7-10 player games", () => {
    let game = createInitialGame({
      playerCount: 7,
      roles: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
      questIndex: 3
    });
    game = proposeTeam(game, "p1", ["p1", "p2", "p5", "p6"]);
    for (const player of game.players) {
      game = castVote(game, player.id, true);
    }
    game = submitQuestCard(game, "p1", "success");
    game = submitQuestCard(game, "p2", "success");
    game = submitQuestCard(game, "p5", "fail");
    game = submitQuestCard(game, "p6", "success");

    expect(game.questResults.at(-1)).toMatchObject({ failCards: 1, succeeded: true });
  });

  it("moves to assassination after the third successful quest and resolves Merlin guesses", () => {
    const game = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      questResults: [
        { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
        { teamIds: ["p1", "p3", "p4"], failCards: 0, succeeded: true },
        { teamIds: ["p2", "p3"], failCards: 0, succeeded: true }
      ],
      phase: "assassination"
    });

    expect(assassinateMerlin(game, "p4", "p2")).toMatchObject({ phase: "gameOver", winner: "good" });
    expect(assassinateMerlin(game, "p4", "p1")).toMatchObject({ phase: "gameOver", winner: "evil", winReason: "assassination" });
  });

  it("does not let the Assassin target themself", () => {
    const game = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination"
    });

    expect(() => assassinateMerlin(game, "p4", "p4")).toThrow(/cannot target themself/i);
  });
});
