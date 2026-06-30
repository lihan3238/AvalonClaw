import type { AiActionKind, LegalAction } from "../ai/types";
import { getQuestConfig } from "./rules";
import type { GameState } from "./types";

export function getLegalActionsForPlayer(state: GameState, playerId: string, actionKind: AiActionKind): LegalAction[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  if (actionKind === "proposeTeam") {
    const teamSize = getQuestConfig(state.playerCount)[state.questIndex].teamSize;
    return combinations(state.players.map((candidate) => candidate.id), teamSize).map((teamIds) => ({ type: "proposeTeam", teamIds }));
  }

  if (actionKind === "vote") {
    return [{ type: "vote", approve: true }, { type: "vote", approve: false }];
  }

  if (actionKind === "quest") {
    return player.allegiance === "good"
      ? [{ type: "quest", card: "success" }]
      : [{ type: "quest", card: "success" }, { type: "quest", card: "fail" }];
  }

  return state.players
    .filter((candidate) => candidate.id !== playerId)
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
