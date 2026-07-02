export type Allegiance = "good" | "evil";

export type Role =
  | "merlin"
  | "percival"
  | "loyal"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "minion";

export type GamePhase = "proposal" | "discussion" | "voting" | "quest" | "assassination" | "gameOver";

export type Vote = "approve" | "reject";
export type QuestCard = "success" | "fail";
export type Winner = "good" | "evil";
export type WinReason = "questSuccesses" | "questFailures" | "voteTrack" | "assassination";

export interface RoleDefinition {
  role: Role;
  label: string;
  allegiance: Allegiance;
}

export interface Player {
  id: string;
  seat: number;
  name: string;
  isHuman: boolean;
  role: Role;
  allegiance: Allegiance;
}

export interface QuestConfig {
  teamSize: number;
  failsRequired: number;
}

export interface QuestResult {
  teamIds: string[];
  failCards: number;
  succeeded: boolean;
}

export interface Proposal {
  leaderId: string;
  teamIds: string[];
}

export interface DiscussionState {
  nextSpeakerIndex: number;
  spokenIds: string[];
}

export interface GameState {
  playerCount: number;
  players: Player[];
  humanSeat: number;
  phase: GamePhase;
  leaderIndex: number;
  questIndex: number;
  failedVotes: number;
  proposal?: Proposal;
  discussion?: DiscussionState;
  votes: Record<string, Vote>;
  questCards: Record<string, QuestCard>;
  questResults: QuestResult[];
  winner?: Winner;
  winReason?: WinReason;
}

export interface RoleKnowledge {
  knownEvilIds: string[];
  merlinCandidateIds: string[];
}

export interface CreateGameOptions {
  playerCount: number;
  humanSeat?: number;
  roles?: Role[];
  phase?: GamePhase;
  questIndex?: number;
  questResults?: QuestResult[];
  failedVotes?: number;
  leaderIndex?: number;
  seed?: number;
}
