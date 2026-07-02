import { getRoleKnowledge } from "./rules";
import type { GameState, QuestCard, RoleKnowledge, Vote } from "./types";

// Multiplayer guests must never receive hidden information: other players'
// roles, unresolved vote values, or unresolved quest card values. The host
// browser keeps the true state; the server serves guests this redacted view.

export interface RedactedGameView {
  game: GameState;
  knowledge: RoleKnowledge;
}

const HIDDEN_VOTE: Vote = "approve";
const HIDDEN_QUEST_CARD: QuestCard = "success";

export function redactGameForSeat(state: GameState, viewerSeat: number): RedactedGameView {
  const viewer = state.players[viewerSeat];
  if (!viewer) {
    throw new Error(`Unknown viewer seat ${viewerSeat}`);
  }

  const knowledge = getRoleKnowledge(state, viewer.id);
  const revealRoles = state.phase === "gameOver";
  const votesResolved = state.phase !== "voting";

  const game: GameState = {
    ...state,
    humanSeat: viewerSeat,
    players: state.players.map((player) => {
      if (player.id === viewer.id || revealRoles) {
        return { ...player };
      }
      return { ...player, role: "loyal", allegiance: "good" };
    }),
    proposal: state.proposal ? { leaderId: state.proposal.leaderId, teamIds: [...state.proposal.teamIds] } : undefined,
    discussion: state.discussion
      ? { nextSpeakerIndex: state.discussion.nextSpeakerIndex, spokenIds: [...state.discussion.spokenIds] }
      : undefined,
    votes: Object.fromEntries(
      Object.entries(state.votes).map(([id, vote]) => [id, votesResolved || id === viewer.id ? vote : HIDDEN_VOTE])
    ),
    // Quest cards are shuffled before reveal at a real table, so another
    // player's card value is never attributable — only its presence is public.
    questCards: Object.fromEntries(
      Object.entries(state.questCards).map(([id, card]) => [id, id === viewer.id ? card : HIDDEN_QUEST_CARD])
    ),
    questResults: state.questResults.map((result) => ({
      teamIds: [...result.teamIds],
      failCards: result.failCards,
      succeeded: result.succeeded
    }))
  };

  return { game, knowledge };
}
