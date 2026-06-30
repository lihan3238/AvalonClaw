import { z } from "zod";
import { getRoleKnowledge, ROLE_DEFINITIONS } from "../game/rules";
import type { GameState, Player } from "../game/types";
import type { AiActionKind, AiDecision, AiDecisionResult, ChatMessage, LegalAction, Persona, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";

interface BuildPromptInput {
  state: GameState;
  playerId: string;
  actionKind: AiActionKind;
  legalActions: LegalAction[];
  tableTalk?: PublicTalkEntry[];
  persona: Persona;
  reasoningEffort: ReasoningEffort;
  language?: TableLanguage;
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("proposeTeam"), teamIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("vote"), approve: z.boolean() }),
  z.object({ type: z.literal("quest"), card: z.enum(["success", "fail"]) }),
  z.object({ type: z.literal("assassinate"), targetId: z.string() })
]);

const decisionSchema = z.object({
  speech: z.string().trim().min(1).max(360),
  action: actionSchema
});

export function createPersona(playerId: string, playerCount: number): Persona {
  const seed = hashString(`${playerId}:${playerCount}:avalon`);
  return {
    caution: scale(seed, 0),
    aggression: scale(seed, 8),
    talkativeness: scale(seed, 16),
    trustBias: scale(seed, 24),
    deceptionComfort: scale(seed, 32)
  };
}

export function buildAIPrompt(input: BuildPromptInput): { messages: ChatMessage[] } {
  const player = requirePlayer(input.state, input.playerId);
  const knowledge = getRoleKnowledge(input.state, input.playerId);
  const publicState = summarizePublicState(input.state);
  const privateState = [
    `You are ${player.id}, seat ${player.seat + 1}, role ${ROLE_DEFINITIONS[player.role].label}, allegiance ${player.allegiance}.`,
    `Known evil players: ${knowledge.knownEvilIds.length ? knowledge.knownEvilIds.join(", ") : "none"}.`,
    `Merlin candidates: ${knowledge.merlinCandidateIds.length ? knowledge.merlinCandidateIds.join(", ") : "none"}.`,
    roleWarnings(player)
  ].join("\n");

  const system = [
    "You are an AI player in The Resistance: Avalon.",
    "You must obey the game rules and copy exactly one action object from the provided legalActions JSON.",
    "Your speech is public table talk: never reveal your role, allegiance, private knowledge, quest card, or hidden reasoning as certainty unless public evidence alone supports it.",
    input.language === "zh" ? "Write your speech in Simplified Chinese." : "Write your speech in English.",
    "Speak briefly as a table player, then output only a JSON object with keys speech and action.",
    "Valid JSON shape: {\"speech\":\"short public statement\",\"action\": legalAction}."
  ].join(" ");

  const user = [
    `Current decision type: ${input.actionKind}.`,
    `Thinking strength: ${input.reasoningEffort}. ${reasoningInstruction(input.reasoningEffort)}`,
    `Persona: caution=${input.persona.caution.toFixed(2)}, aggression=${input.persona.aggression.toFixed(2)}, talkativeness=${input.persona.talkativeness.toFixed(2)}, trustBias=${input.persona.trustBias.toFixed(2)}, deceptionComfort=${input.persona.deceptionComfort.toFixed(2)}.`,
    "",
    "Private information:",
    privateState,
    "",
    "Public game state:",
    publicState,
    "",
    "Public table talk:",
    summarizeTableTalk(input.tableTalk ?? []),
    "",
    "Role strategy:",
    roleStrategy(player),
    "",
    `legalActions: ${JSON.stringify(input.legalActions)}`,
    "",
    "Return only JSON. Do not use markdown."
  ].join("\n");

  return { messages: [{ role: "system", content: system }, { role: "user", content: user }] };
}

export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function parseAiDecision(raw: string, legalActions: LegalAction[], fallback: AiDecision): AiDecisionResult {
  const json = extractJsonObject(raw);
  if (!json) {
    return { ...fallback, source: "fallback" };
  }

  try {
    const parsed = decisionSchema.parse(JSON.parse(json));
    if (!legalActions.some((action) => sameAction(action, parsed.action))) {
      return { ...fallback, source: "fallback" };
    }

    return { speech: parsed.speech, action: parsed.action, source: "model" };
  } catch {
    return { ...fallback, source: "fallback" };
  }
}

export function sameAction(left: LegalAction, right: LegalAction): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "proposeTeam" && right.type === "proposeTeam") {
    return left.teamIds.length === right.teamIds.length && left.teamIds.every((id, index) => id === right.teamIds[index]);
  }
  if (left.type === "vote" && right.type === "vote") {
    return left.approve === right.approve;
  }
  if (left.type === "quest" && right.type === "quest") {
    return left.card === right.card;
  }
  if (left.type === "assassinate" && right.type === "assassinate") {
    return left.targetId === right.targetId;
  }

  return false;
}

function summarizePublicState(state: GameState): string {
  const players = state.players.map((player) => `${player.id}(seat ${player.seat + 1})${player.isHuman ? " human" : " AI"}`).join(", ");
  const quests = state.questResults.length
    ? state.questResults.map((quest, index) => `Q${index + 1}: team ${quest.teamIds.join("+")}, ${quest.failCards} fail, ${quest.succeeded ? "success" : "fail"}`).join("; ")
    : "none";
  const proposal = state.proposal ? `${state.proposal.leaderId} proposed ${state.proposal.teamIds.join(", ")}` : "none";
  const votes = summarizeVotes(state);
  const questCards = summarizeQuestCardSubmissions(state);

  return [
    `Players: ${players}.`,
    `Phase: ${state.phase}. Quest number: ${state.questIndex + 1}. Failed proposal counter: ${state.failedVotes}.`,
    `Leader: ${state.players[state.leaderIndex]?.id ?? "unknown"}. Current proposal: ${proposal}.`,
    `Votes: ${votes}.`,
    `Quest cards: ${questCards}. Quest history: ${quests}.`
  ].join("\n");
}

function summarizeVotes(state: GameState): string {
  const submitted = Object.keys(state.votes).length;
  if (state.phase === "voting" && submitted < state.playerCount) {
    return `Vote submissions: ${submitted} of ${state.playerCount} submitted; individual votes are hidden until all players have voted`;
  }
  if (!submitted) {
    return "none";
  }

  return `Revealed votes: ${Object.entries(state.votes).map(([id, vote]) => `${id}:${vote}`).join(", ")}`;
}

function summarizeQuestCardSubmissions(state: GameState): string {
  const submitted = Object.keys(state.questCards).length;
  if (state.phase === "quest" && state.proposal) {
    return `Quest card submissions: ${submitted} of ${state.proposal.teamIds.length} submitted; individual quest cards are hidden`;
  }
  return "individual quest cards are hidden; only resolved fail-card counts are public";
}

function summarizeTableTalk(tableTalk: PublicTalkEntry[]): string {
  if (!tableTalk.length) {
    return "none";
  }

  return tableTalk.slice(-12).map((entry) => `${entry.speakerId} ${entry.speakerName}: ${entry.text}`).join("\n");
}

function roleWarnings(player: Player): string {
  if (player.role === "merlin") {
    return "Mordred may be hidden from Merlin. Guide Good subtly; do not make yourself obvious to the Assassin.";
  }
  if (player.role === "percival") {
    return "Do not state that either candidate is certainly Merlin. Protect the real Merlin by creating cover.";
  }
  if (player.allegiance === "evil") {
    return "You may deceive in table talk, but your chosen action must still be legal.";
  }

  return "You have no private role knowledge. Infer from public proposals, votes, quest teams, and outcomes.";
}

function roleStrategy(player: Player): string {
  if (player.role === "merlin") {
    return "Nudge teams away from known evil players while sounding like you are reading public behavior.";
  }
  if (player.role === "percival") {
    return "Compare the two Merlin candidates without revealing which one you trust. Create plausible Merlin cover when needed.";
  }
  if (player.role === "assassin") {
    return "Win quests when useful, sabotage when it creates advantage, and track who seems to guide Good with hidden confidence.";
  }
  if (player.allegiance === "evil") {
    return "Blend into Good voting patterns, avoid repeated mechanical sabotage, and cast doubt on accurate Good reads.";
  }

  return "Build trust through consistent public reasoning. Protect possible Merlin players and pressure suspicious voting or quest patterns.";
}

function reasoningInstruction(effort: ReasoningEffort): string {
  if (effort === "high") {
    return "Before answering, consider quest history, vote incentives, role cover, and how your public speech affects Merlin hunting.";
  }
  if (effort === "medium") {
    return "Consider recent proposals, votes, and quest outcomes before choosing.";
  }

  return "Use a concise heuristic and avoid over-explaining.";
}

function requirePlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }

  return player;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scale(seed: number, shift: number): number {
  return (((seed >>> shift) & 0xff) + 1) / 256;
}
