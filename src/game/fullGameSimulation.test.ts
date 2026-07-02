import { chooseFallbackDecision } from "../ai/fallback";
import type { AiActionKind, LegalAction } from "../ai/types";
import {
  assassinateMerlin,
  advanceDiscussionTurn,
  castVote,
  createInitialGame,
  getFailedQuestCount,
  getQuestConfig,
  getSuccessfulQuestCount,
  proposeTeam,
  submitQuestCard
} from "./rules";
import type { GameState } from "./types";

describe("fallback agent full-game simulations", () => {
  it("plays seeded 5-10 player games through terminal states", () => {
    const outcomes = [];

    for (const playerCount of [5, 6, 7, 8, 9, 10]) {
      for (const seed of [11, 29, 47, 83, 131, 197]) {
        const result = playFallbackGame(playerCount, seed);
        outcomes.push(result.final.winner);

        expect(result.final.phase).toBe("gameOver");
        expect(result.final.winner).toMatch(/good|evil/);
        expect(result.final.winReason).toMatch(/questSuccesses|questFailures|voteTrack|assassination/);
        expect(result.steps).toBeLessThan(650);
      }
    }

    expect(outcomes).toContain("good");
    expect(outcomes).toContain("evil");
  });
});

function playFallbackGame(playerCount: number, seed: number): { final: GameState; steps: number } {
  let state = createInitialGame({
    playerCount,
    humanSeat: seed % playerCount,
    seed
  });

  for (let steps = 0; steps < 650; steps += 1) {
    assertStateInvariants(state);
    if (state.phase === "gameOver") {
      return { final: state, steps };
    }

    const next = getNextAutoplayAction(state);
    const decision = chooseFallbackDecision(state, next.playerId, next.actionKind, "en");
    state = applyLegalAction(state, next.playerId, decision.action);
  }

  throw new Error(`Simulation did not finish for ${playerCount} players with seed ${seed}`);
}

function getNextAutoplayAction(state: GameState): { playerId: string; actionKind: AiActionKind } {
  if (state.phase === "proposal") {
    return { playerId: state.players[state.leaderIndex].id, actionKind: "proposeTeam" };
  }
  if (state.phase === "discussion" && state.discussion) {
    const speaker = state.players[state.discussion.nextSpeakerIndex];
    return { playerId: speaker.id, actionKind: "speak" };
  }
  if (state.phase === "voting") {
    const voter = state.players.find((player) => !state.votes[player.id]);
    if (!voter) {
      throw new Error("Voting phase has no remaining voter");
    }
    return { playerId: voter.id, actionKind: "vote" };
  }
  if (state.phase === "quest") {
    const quester = state.players.find((player) => state.proposal?.teamIds.includes(player.id) && !state.questCards[player.id]);
    if (!quester) {
      throw new Error("Quest phase has no remaining quester");
    }
    return { playerId: quester.id, actionKind: "quest" };
  }

  const assassin = state.players.find((player) => player.role === "assassin");
  if (!assassin) {
    throw new Error("Assassination phase requires an Assassin");
  }
  return { playerId: assassin.id, actionKind: "assassinate" };
}

function applyLegalAction(state: GameState, playerId: string, action: LegalAction): GameState {
  if (action.type === "proposeTeam") {
    return proposeTeam(state, playerId, action.teamIds);
  }
  if (action.type === "speak") {
    return advanceDiscussionTurn(state, playerId);
  }
  if (action.type === "vote") {
    return castVote(state, playerId, action.approve);
  }
  if (action.type === "quest") {
    return submitQuestCard(state, playerId, action.card);
  }
  return assassinateMerlin(state, playerId, action.targetId);
}

function assertStateInvariants(state: GameState): void {
  expect(state.questResults.length).toBeLessThanOrEqual(5);
  expect(getSuccessfulQuestCount(state)).toBeLessThanOrEqual(3);
  expect(getFailedQuestCount(state)).toBeLessThanOrEqual(3);
  expect(state.failedVotes).toBeGreaterThanOrEqual(0);
  expect(state.failedVotes).toBeLessThanOrEqual(5);

  if (state.proposal) {
    const expectedTeamSize = getQuestConfig(state.playerCount)[state.questIndex].teamSize;
    expect(new Set(state.proposal.teamIds).size).toBe(state.proposal.teamIds.length);
    expect(state.proposal.teamIds).toHaveLength(expectedTeamSize);
  }

  for (const [playerId, card] of Object.entries(state.questCards)) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    expect(player).toBeDefined();
    if (player?.allegiance === "good") {
      expect(card).toBe("success");
    }
  }

  if (state.phase === "gameOver") {
    expect(state.winner).toBeDefined();
    expect(state.winReason).toBeDefined();
  } else {
    expect(state.winner).toBeUndefined();
    expect(state.winReason).toBeUndefined();
  }
}
