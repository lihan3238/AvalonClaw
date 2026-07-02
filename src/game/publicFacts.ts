import type { GameState, QuestResult } from "./types";

export interface PublicFacts {
  publicGood: string[];
  publicEvil: string[];
  possibleWorldCount: number;
  constraints: string[];
}

export function derivePublicFacts(input: {
  playerIds: string[];
  evilCount: number;
  questResults: QuestResult[];
}): PublicFacts {
  const playerIds = [...input.playerIds].sort(comparePlayerIds);
  const possibleWorlds = enumerateEvilWorlds(playerIds, input.evilCount)
    .filter((world) => input.questResults.every((quest) => satisfiesQuestConstraint(world, quest)));

  if (!possibleWorlds.length) {
    return {
      publicGood: [],
      publicEvil: [],
      possibleWorldCount: 0,
      constraints: summarizeConstraints(input.questResults)
    };
  }

  const publicEvil = playerIds.filter((id) => possibleWorlds.every((world) => world.has(id)));
  const publicGood = playerIds.filter((id) => possibleWorlds.every((world) => !world.has(id)));
  return {
    publicGood,
    publicEvil,
    possibleWorldCount: possibleWorlds.length,
    constraints: summarizeConstraints(input.questResults)
  };
}

export function derivePublicFactsFromState(state: GameState): PublicFacts {
  const goodCount = state.players.filter((player) => player.allegiance === "good").length;
  return derivePublicFacts({
    playerIds: state.players.map((player) => player.id),
    evilCount: state.players.length - goodCount,
    questResults: state.questResults
  });
}

function satisfiesQuestConstraint(evilWorld: Set<string>, quest: QuestResult): boolean {
  if (quest.failCards <= 0) {
    return true;
  }
  const evilOnTeam = quest.teamIds.filter((id) => evilWorld.has(id)).length;
  return evilOnTeam >= quest.failCards;
}

function enumerateEvilWorlds(playerIds: string[], evilCount: number): Array<Set<string>> {
  const worlds: Array<Set<string>> = [];
  const current: string[] = [];

  function visit(start: number): void {
    if (current.length === evilCount) {
      worlds.push(new Set(current));
      return;
    }
    const remaining = evilCount - current.length;
    for (let index = start; index <= playerIds.length - remaining; index += 1) {
      current.push(playerIds[index]);
      visit(index + 1);
      current.pop();
    }
  }

  visit(0);
  return worlds;
}

function summarizeConstraints(questResults: QuestResult[]): string[] {
  return questResults
    .map((quest, index) => {
      if (quest.failCards <= 0) {
        return `Q${index + 1}:${quest.teamIds.join("+")}:0F no-hard-good`;
      }
      return `Q${index + 1}:${quest.teamIds.join("+")}:>=${quest.failCards}E`;
    });
}

function comparePlayerIds(left: string, right: string): number {
  return playerIdNumber(left) - playerIdNumber(right);
}

function playerIdNumber(playerId: string): number {
  const match = /^p(\d+)$/u.exec(playerId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
