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

  it("rejects unsupported player counts even with custom role lineups", () => {
    expect(() => createInitialGame({
      playerCount: 4,
      roles: ["merlin", "loyal", "assassin", "morgana"]
    })).toThrow(/supports 5-10 players/i);
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

  it("uses the official quest-four fail threshold for each player count", () => {
    const oneFailExpected = new Map([
      [5, false],
      [6, false],
      [7, true],
      [8, true],
      [9, true],
      [10, true]
    ]);

    for (const [playerCount, oneFailSucceeds] of oneFailExpected) {
      expect(resolveQuestFour(playerCount, 1).questResults.at(-1)).toMatchObject({ failCards: 1, succeeded: oneFailSucceeds });
    }
    for (const playerCount of [7, 8, 9, 10]) {
      expect(resolveQuestFour(playerCount, 2).questResults.at(-1)).toMatchObject({ failCards: 2, succeeded: false });
    }
  });

  it("moves to assassination after the third successful quest and resolves Merlin guesses", () => {
    const game = createAssassinationGame();

    expect(assassinateMerlin(game, "p4", "p2")).toMatchObject({ phase: "gameOver", winner: "good" });
    expect(assassinateMerlin(game, "p4", "p1")).toMatchObject({ phase: "gameOver", winner: "evil", winReason: "assassination" });
  });

  it("does not let the Assassin target themself", () => {
    const game = createAssassinationGame();

    expect(() => assassinateMerlin(game, "p4", "p4")).toThrow(/cannot target themself/i);
  });

  it("only lets the Assassin name a good player after three successful quests", () => {
    const game = createAssassinationGame();
    const premature = createInitialGame({
      playerCount: 5,
      roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
      phase: "assassination"
    });

    expect(() => assassinateMerlin(game, "p4", "p5")).toThrow(/good player/i);
    expect(() => assassinateMerlin(premature, "p4", "p1")).toThrow(/three successful quests/i);
  });
});

function createAssassinationGame() {
  return createInitialGame({
    playerCount: 5,
    roles: ["merlin", "percival", "loyal", "assassin", "morgana"],
    questResults: [
      { teamIds: ["p1", "p2"], failCards: 0, succeeded: true },
      { teamIds: ["p1", "p3", "p4"], failCards: 0, succeeded: true },
      { teamIds: ["p2", "p3"], failCards: 0, succeeded: true }
    ],
    phase: "assassination"
  });
}

function resolveQuestFour(playerCount: number, failCards: 1 | 2) {
  const roles = getQuestFourRoles(playerCount);
  const teamIds = getQuestFourTeam(playerCount);
  let game = createInitialGame({ playerCount, roles, questIndex: 3 });
  game = proposeTeam(game, "p1", teamIds);
  for (const player of game.players) {
    game = castVote(game, player.id, true);
  }

  let submittedFails = 0;
  for (const playerId of teamIds) {
    const player = game.players.find((candidate) => candidate.id === playerId);
    const canFail = player?.allegiance === "evil" && submittedFails < failCards;
    game = submitQuestCard(game, playerId, canFail ? "fail" : "success");
    if (canFail) {
      submittedFails += 1;
    }
  }
  expect(submittedFails).toBe(failCards);
  return game;
}

function getQuestFourRoles(playerCount: number) {
  const rolesByPlayerCount = {
    5: ["merlin", "percival", "loyal", "assassin", "morgana"],
    6: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana"],
    7: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
    8: ["merlin", "percival", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
    9: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
    10: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred", "oberon"]
  } as const;

  return [...rolesByPlayerCount[playerCount as keyof typeof rolesByPlayerCount]];
}

function getQuestFourTeam(playerCount: number): string[] {
  if (playerCount === 5 || playerCount === 6) {
    return ["p1", "p2", "p5"];
  }
  if (playerCount === 7) {
    return ["p1", "p2", "p5", "p6"];
  }
  return ["p1", "p2", "p3", "p7", "p8"];
}
