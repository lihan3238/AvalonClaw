import type { AiActionKind, LegalAction } from "../ai/types";
import { getQuestConfig, getSuccessfulQuestCount } from "./rules";
import type { GameState } from "./types";

export function getLegalActionsForPlayer(state: GameState, playerId: string, actionKind: AiActionKind): LegalAction[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  if (actionKind === "proposeTeam") {
    if (state.phase !== "proposal") {
      throw new Error("Proposal actions are only available during proposal phase");
    }
    const leader = state.players[state.leaderIndex];
    if (leader.id !== playerId) {
      throw new Error(`${playerId} is not the current leader`);
    }

    const teamSize = getQuestConfig(state.playerCount)[state.questIndex].teamSize;
    return combinations(state.players.map((candidate) => candidate.id), teamSize).map((teamIds) => ({ type: "proposeTeam", teamIds }));
  }

  if (actionKind === "vote") {
    if (state.phase !== "voting" || !state.proposal) {
      throw new Error("Vote actions are only available during voting phase");
    }
    if (state.votes[playerId]) {
      throw new Error(`${playerId} has already voted`);
    }

    return [{ type: "vote", approve: true }, { type: "vote", approve: false }];
  }

  if (actionKind === "quest") {
    if (state.phase !== "quest" || !state.proposal) {
      throw new Error("Quest actions are only available during quest phase");
    }
    if (!state.proposal.teamIds.includes(playerId)) {
      throw new Error(`${playerId} is not on the current quest team`);
    }
    if (state.questCards[playerId]) {
      throw new Error(`${playerId} has already submitted a quest card`);
    }

    return player.allegiance === "good"
      ? [{ type: "quest", card: "success" }]
      : [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }];
  }

  if (state.phase !== "assassination") {
    throw new Error("Assassination actions are only available during assassination phase");
  }
  if (getSuccessfulQuestCount(state) < 3) {
    throw new Error("Assassination actions are only available after three successful quests");
  }
  if (player.role !== "assassin") {
    throw new Error("Only the Assassin can choose the Merlin target");
  }

  return state.players
    .filter((candidate) => candidate.allegiance === "good")
    .map((candidate) => ({ type: "assassinate", targetId: candidate.id }));
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }
  if (items.length < size) {
    return [];
  }

  const [head, ...tail] = items;
  return [
    ...combinations(tail, size - 1).map((combo) => [head, ...combo]),
    ...combinations(tail, size)
  ];
}
