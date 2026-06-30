import { getQuestConfig, getRoleKnowledge } from "../game/rules";
import type { GameState } from "../game/types";
import type { AiActionKind, AiDecision, TableLanguage } from "./types";

export function chooseFallbackDecision(state: GameState, playerId: string, actionKind: AiActionKind, language: TableLanguage = "en"): AiDecision {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  if (actionKind === "proposeTeam") {
    const teamSize = getQuestConfig(state.playerCount)[state.questIndex].teamSize;
    const knowledge = getRoleKnowledge(state, playerId);
    const avoided = new Set(player.allegiance === "good" ? knowledge.knownEvilIds : []);
    const candidates = state.players
      .filter((candidate) => candidate.id !== playerId)
      .sort((left, right) => proposalScore(state, right.id, avoided) - proposalScore(state, left.id, avoided) || left.seat - right.seat)
      .map((candidate) => candidate.id);
    const teamIds = [playerId, ...candidates].slice(0, teamSize);
    return {
      speech: language === "zh" ? "我先提一个清晰、容易检验的队伍。" : "I will keep this team straightforward and readable.",
      action: { type: "proposeTeam", teamIds }
    };
  }

  if (actionKind === "vote") {
    const team = state.proposal?.teamIds ?? [];
    const knowledge = getRoleKnowledge(state, playerId);
    const containsKnownEvil = player.allegiance === "good" && team.some((id) => knowledge.knownEvilIds.includes(id));
    const approve = containsKnownEvil ? false : team.includes(playerId) || state.failedVotes >= 2;
    return {
      speech: approve
        ? language === "zh" ? "这队目前可以接受。" : "This team is acceptable for now."
        : language === "zh" ? "我想先看一个更干净的提案。" : "I want a cleaner proposal before approving.",
      action: { type: "vote", approve }
    };
  }

  if (actionKind === "quest") {
    const card = chooseQuestCard(state, playerId);
    return {
      speech: language === "zh" ? "我来处理这次任务。" : "I am resolving the quest.",
      action: { type: "quest", card }
    };
  }

  const target = chooseAssassinationTarget(state, playerId);
  return {
    speech: language === "zh" ? "我认为这个人最像在暗中带队。" : "I think this player had the clearest hidden guidance.",
    action: { type: "assassinate", targetId: target.id }
  };
}

function chooseQuestCard(state: GameState, playerId: string): "success" | "fail" {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.allegiance === "good") {
    return "success";
  }

  const config = getQuestConfig(state.playerCount)[state.questIndex];
  const teamIds = state.proposal?.teamIds ?? [];
  const evilOnTeam = teamIds.filter((id) => state.players.find((candidate) => candidate.id === id)?.allegiance === "evil").length;
  const failCardsAlreadySubmitted = Object.values(state.questCards).filter((card) => card === "fail").length;
  if (config.failsRequired > 1 && evilOnTeam <= 1 && failCardsAlreadySubmitted === 0) {
    return "success";
  }

  return "fail";
}

function proposalScore(state: GameState, playerId: string, avoided: Set<string>): number {
  if (avoided.has(playerId)) {
    return -100;
  }

  return state.questResults.reduce((score, quest) => {
    if (!quest.teamIds.includes(playerId)) {
      return score;
    }
    return score + (quest.succeeded ? 2 : -3);
  }, 0);
}

function chooseAssassinationTarget(state: GameState, assassinId: string) {
  const knowledge = getRoleKnowledge(state, assassinId);
  const knownEvil = new Set(knowledge.knownEvilIds);
  const legalTargets = state.players.filter((candidate) => candidate.id !== assassinId);
  const candidates = legalTargets.filter((candidate) => !knownEvil.has(candidate.id));
  const targetPool = candidates.length ? candidates : legalTargets;

  return [...targetPool].sort((left, right) => {
    const scoreDelta = publicMerlinLikelihood(state, right.id) - publicMerlinLikelihood(state, left.id);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.seat - right.seat;
  })[0];
}

function publicMerlinLikelihood(state: GameState, playerId: string): number {
  return state.questResults.reduce((score, quest) => {
    if (!quest.teamIds.includes(playerId)) {
      return score;
    }
    return score + (quest.succeeded ? 2 : -1);
  }, 0);
}
