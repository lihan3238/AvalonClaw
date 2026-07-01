import type {
  Allegiance,
  CreateGameOptions,
  GameState,
  Player,
  QuestCard,
  QuestConfig,
  QuestResult,
  Role,
  RoleDefinition,
  RoleKnowledge,
  Vote
} from "./types";

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  merlin: { role: "merlin", label: "Merlin", allegiance: "good" },
  percival: { role: "percival", label: "Percival", allegiance: "good" },
  loyal: { role: "loyal", label: "Loyal Servant", allegiance: "good" },
  assassin: { role: "assassin", label: "Assassin", allegiance: "evil" },
  morgana: { role: "morgana", label: "Morgana", allegiance: "evil" },
  mordred: { role: "mordred", label: "Mordred", allegiance: "evil" },
  oberon: { role: "oberon", label: "Oberon", allegiance: "evil" },
  minion: { role: "minion", label: "Minion of Mordred", allegiance: "evil" }
};

const QUEST_TABLE: Record<number, QuestConfig[]> = {
  5: [
    { teamSize: 2, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 2, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 }
  ],
  6: [
    { teamSize: 2, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 }
  ],
  7: [
    { teamSize: 2, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 2 },
    { teamSize: 4, failsRequired: 1 }
  ],
  8: [
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 5, failsRequired: 2 },
    { teamSize: 5, failsRequired: 1 }
  ],
  9: [
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 5, failsRequired: 2 },
    { teamSize: 5, failsRequired: 1 }
  ],
  10: [
    { teamSize: 3, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 4, failsRequired: 1 },
    { teamSize: 5, failsRequired: 2 },
    { teamSize: 5, failsRequired: 1 }
  ]
};

const DEFAULT_ROLE_LINEUPS: Record<number, Role[]> = {
  5: ["merlin", "percival", "loyal", "assassin", "morgana"],
  6: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana"],
  7: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
  8: ["merlin", "percival", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
  9: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
  10: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred", "oberon"]
};

export function getQuestConfig(playerCount: number): QuestConfig[] {
  const config = QUEST_TABLE[playerCount];
  if (!config) {
    throw new Error("Avalon supports 5-10 players");
  }

  return config.map((quest) => ({ ...quest }));
}

export function getDefaultRoles(playerCount: number): RoleDefinition[] {
  const lineup = DEFAULT_ROLE_LINEUPS[playerCount];
  if (!lineup) {
    throw new Error("Avalon supports 5-10 players");
  }

  return lineup.map((role) => ROLE_DEFINITIONS[role]);
}

export function createInitialGame(options: CreateGameOptions): GameState {
  const humanSeat = options.humanSeat ?? 0;
  if (!QUEST_TABLE[options.playerCount]) {
    throw new Error("Avalon supports 5-10 players");
  }

  const roleLineup = options.roles ?? shuffle(DEFAULT_ROLE_LINEUPS[options.playerCount], options.seed ?? 1);

  if (!roleLineup || roleLineup.length !== options.playerCount) {
    throw new Error(`Expected ${options.playerCount} roles`);
  }
  if (humanSeat < 0 || humanSeat >= options.playerCount) {
    throw new Error("Human seat is outside the player range");
  }

  const players: Player[] = roleLineup.map((role, index) => ({
    id: `p${index + 1}`,
    seat: index,
    name: index === humanSeat ? "You" : `AI ${index + 1}`,
    isHuman: index === humanSeat,
    role,
    allegiance: ROLE_DEFINITIONS[role].allegiance
  }));

  return {
    playerCount: options.playerCount,
    players,
    humanSeat,
    phase: options.phase ?? "proposal",
    leaderIndex: options.leaderIndex ?? 0,
    questIndex: options.questIndex ?? options.questResults?.length ?? 0,
    failedVotes: options.failedVotes ?? 0,
    votes: {},
    questCards: {},
    questResults: options.questResults ? cloneQuestResults(options.questResults) : []
  };
}

export function getRoleKnowledge(state: GameState, playerId: string): RoleKnowledge {
  const player = requirePlayer(state, playerId);
  if (player.role === "merlin") {
    return {
      knownEvilIds: state.players.filter((candidate) => candidate.allegiance === "evil" && candidate.role !== "mordred").map((candidate) => candidate.id),
      merlinCandidateIds: []
    };
  }

  if (player.role === "percival") {
    return {
      knownEvilIds: [],
      merlinCandidateIds: state.players.filter((candidate) => candidate.role === "merlin" || candidate.role === "morgana").map((candidate) => candidate.id)
    };
  }

  if (player.allegiance === "evil" && player.role !== "oberon") {
    return {
      knownEvilIds: state.players
        .filter((candidate) => candidate.allegiance === "evil" && candidate.id !== player.id && candidate.role !== "oberon")
        .map((candidate) => candidate.id),
      merlinCandidateIds: []
    };
  }

  return { knownEvilIds: [], merlinCandidateIds: [] };
}

export function proposeTeam(state: GameState, leaderId: string, teamIds: string[]): GameState {
  if (state.phase !== "proposal") {
    throw new Error("Teams can only be proposed during proposal phase");
  }
  const leader = state.players[state.leaderIndex];
  if (leader.id !== leaderId) {
    throw new Error(`${leaderId} is not the current leader`);
  }

  const requiredSize = getQuestConfig(state.playerCount)[state.questIndex].teamSize;
  const uniqueTeamIds = [...new Set(teamIds)];
  if (uniqueTeamIds.length !== teamIds.length) {
    throw new Error("Team cannot contain duplicate players");
  }
  if (teamIds.length !== requiredSize) {
    throw new Error(`Quest ${state.questIndex + 1} requires ${requiredSize} players`);
  }
  for (const id of teamIds) {
    requirePlayer(state, id);
  }

  return {
    ...cloneState(state),
    phase: "voting",
    proposal: { leaderId, teamIds: [...teamIds] },
    votes: {},
    questCards: {}
  };
}

export function castVote(state: GameState, playerId: string, approve: boolean): GameState {
  if (state.phase !== "voting" || !state.proposal) {
    throw new Error("Votes can only be cast during voting phase");
  }
  requirePlayer(state, playerId);
  if (state.votes[playerId]) {
    throw new Error(`${playerId} has already voted`);
  }

  const next = cloneState(state);
  next.votes[playerId] = approve ? "approve" : "reject";

  if (Object.keys(next.votes).length !== next.players.length) {
    return next;
  }

  return resolveVotes(next);
}

export function submitQuestCard(state: GameState, playerId: string, card: QuestCard): GameState {
  if (state.phase !== "quest" || !state.proposal) {
    throw new Error("Quest cards can only be submitted during quest phase");
  }

  const player = requirePlayer(state, playerId);
  if (!state.proposal.teamIds.includes(playerId)) {
    throw new Error(`${playerId} is not on the current quest team`);
  }
  if (state.questCards[playerId]) {
    throw new Error(`${playerId} has already submitted a quest card`);
  }
  if (player.allegiance === "good" && card === "fail") {
    throw new Error("Good players must submit success");
  }

  const questTeamSize = state.proposal.teamIds.length;
  const next = cloneState(state);
  next.questCards[playerId] = card;

  if (Object.keys(next.questCards).length !== questTeamSize) {
    return next;
  }

  return resolveQuest(next);
}

export function assassinateMerlin(state: GameState, assassinId: string, targetId: string): GameState {
  if (state.phase !== "assassination") {
    throw new Error("Assassination is only available after three successful quests");
  }
  if (getSuccessfulQuestCount(state) < 3) {
    throw new Error("Assassination is only available after three successful quests");
  }

  const assassin = requirePlayer(state, assassinId);
  const target = requirePlayer(state, targetId);
  if (assassin.role !== "assassin") {
    throw new Error("Only the Assassin can choose the Merlin target");
  }
  if (assassin.id === target.id) {
    throw new Error("The Assassin cannot target themself");
  }
  if (target.allegiance !== "good") {
    throw new Error("The Assassin must name a good player as Merlin");
  }

  return {
    ...cloneState(state),
    phase: "gameOver",
    winner: target.role === "merlin" ? "evil" : "good",
    winReason: target.role === "merlin" ? "assassination" : "questSuccesses"
  };
}

export function getSuccessfulQuestCount(state: GameState): number {
  return state.questResults.filter((quest) => quest.succeeded).length;
}

export function getFailedQuestCount(state: GameState): number {
  return state.questResults.filter((quest) => !quest.succeeded).length;
}

function resolveVotes(state: GameState): GameState {
  const approvals = Object.values(state.votes).filter((vote: Vote) => vote === "approve").length;
  if (approvals > state.playerCount / 2) {
    return {
      ...state,
      phase: "quest",
      failedVotes: 0,
      questCards: {}
    };
  }

  const failedVotes = state.failedVotes + 1;
  if (failedVotes >= 5) {
    return {
      ...state,
      phase: "gameOver",
      failedVotes,
      winner: "evil",
      winReason: "voteTrack"
    };
  }

  return {
    ...state,
    phase: "proposal",
    failedVotes,
    leaderIndex: nextLeaderIndex(state),
    proposal: undefined,
    votes: {},
    questCards: {}
  };
}

function resolveQuest(state: GameState): GameState {
  if (!state.proposal) {
    throw new Error("Cannot resolve quest without a proposal");
  }

  const failCards = Object.values(state.questCards).filter((card) => card === "fail").length;
  const config = getQuestConfig(state.playerCount)[state.questIndex];
  const result: QuestResult = {
    teamIds: [...state.proposal.teamIds],
    failCards,
    succeeded: failCards < config.failsRequired
  };
  const questResults = [...state.questResults, result];
  const successes = questResults.filter((quest) => quest.succeeded).length;
  const failures = questResults.filter((quest) => !quest.succeeded).length;

  if (failures >= 3) {
    return {
      ...state,
      phase: "gameOver",
      questResults,
      winner: "evil",
      winReason: "questFailures"
    };
  }

  if (successes >= 3) {
    return {
      ...state,
      phase: hasRole(state, "assassin") ? "assassination" : "gameOver",
      questResults,
      winner: hasRole(state, "assassin") ? undefined : "good",
      winReason: hasRole(state, "assassin") ? undefined : "questSuccesses",
      proposal: undefined,
      votes: {},
      questCards: {}
    };
  }

  return {
    ...state,
    phase: "proposal",
    questIndex: state.questIndex + 1,
    leaderIndex: nextLeaderIndex(state),
    proposal: undefined,
    votes: {},
    questCards: {},
    questResults
  };
}

function nextLeaderIndex(state: GameState): number {
  return (state.leaderIndex + 1) % state.players.length;
}

function hasRole(state: GameState, role: Role): boolean {
  return state.players.some((player) => player.role === role);
}

function requirePlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  return player;
}

function roleAllegiance(role: Role): Allegiance {
  return ROLE_DEFINITIONS[role].allegiance;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, allegiance: player.allegiance ?? roleAllegiance(player.role) })),
    proposal: state.proposal ? { leaderId: state.proposal.leaderId, teamIds: [...state.proposal.teamIds] } : undefined,
    votes: { ...state.votes },
    questCards: { ...state.questCards },
    questResults: cloneQuestResults(state.questResults)
  };
}

function cloneQuestResults(results: QuestResult[]): QuestResult[] {
  return results.map((result) => ({
    teamIds: [...result.teamIds],
    failCards: result.failCards,
    succeeded: result.succeeded
  }));
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
