import { z } from "zod";
import { getRoleKnowledge, ROLE_DEFINITIONS } from "../game/rules";
import type { GameState, Player } from "../game/types";
import type { AiActionKind, AiDecision, AiDecisionResult, AiFallbackReason, AiSpeechRepairReason, ChatMessage, LegalAction, Persona, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";

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

const compactActionSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pt"), ids: z.array(z.string()).min(1) }),
  z.object({ t: z.literal("v"), ok: z.boolean() }),
  z.object({ t: z.literal("q"), c: z.enum(["success", "fail"]) }),
  z.object({ t: z.literal("as"), id: z.string() })
]);

const compactDecisionSchema = z.object({
  s: z.string().trim().min(1).max(240),
  a: compactActionSchema
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
    `SELF id=${player.id} seat=${player.seat + 1} role=${player.role} label=${ROLE_DEFINITIONS[player.role].label} side=${player.allegiance}`,
    `KE=${compactList(knowledge.knownEvilIds)} MC=${compactList(knowledge.merlinCandidateIds)}`,
    roleWarnings(player)
  ].join("\n");

  const system = [
    "AVALON_AGENT_V3.",
    "Pick one legal LA; engine validates.",
    "Public speech: never state hidden role/side/private cards/reasoning as certainty.",
    "No public role words; say behavior, timing, team pressure.",
    "JSON only; prefer short keys."
  ].join(" ");

  const user = [
    `L=${input.language === "zh" ? "zh-CN" : "en"} A=${input.actionKind} R=${input.reasoningEffort}:${reasoningInstruction(input.reasoningEffort)}`,
    `PER c=${formatPersona(input.persona.caution)} ag=${formatPersona(input.persona.aggression)} talk=${formatPersona(input.persona.talkativeness)} trust=${formatPersona(input.persona.trustBias)} dec=${formatPersona(input.persona.deceptionComfort)}`,
    privateState,
    publicState,
    summarizeTableTalk(input.tableTalk ?? []),
    `STR ${roleStrategy(player)}`,
    summarizeLegalActions(input.legalActions),
    outputContract(input.actionKind)
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
    return fallbackDecision(fallback, "invalid-json");
  }

  try {
    const parsed = normalizeAiDecision(JSON.parse(json));
    if (!parsed) {
      return fallbackDecision(fallback, "invalid-json");
    }
    if (!legalActions.some((action) => sameAction(action, parsed.action))) {
      return fallbackDecision(fallback, "illegal-action");
    }

    const repaired = parsed.speech === null
      ? { speech: safeSpeechForAction(parsed.action, fallback), reason: "missing-speech" as const }
      : repairPublicSpeech(parsed.speech, parsed.action, fallback);
    return {
      speech: repaired.speech,
      action: parsed.action,
      source: "model",
      ...(repaired.reason ? { speechRepairReason: repaired.reason } : {})
    };
  } catch {
    return fallbackDecision(fallback, "invalid-json");
  }
}

export function sameAction(left: LegalAction, right: LegalAction): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "proposeTeam" && right.type === "proposeTeam") {
    return sameTeam(left.teamIds, right.teamIds);
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

function sameTeam(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function fallbackDecision(fallback: AiDecision, fallbackReason: AiFallbackReason): AiDecisionResult {
  return { ...fallback, source: "fallback", fallbackReason };
}

function repairPublicSpeech(speech: string, action: LegalAction, fallback: AiDecision): { speech: string; reason?: AiSpeechRepairReason } {
  const trimmed = speech.trim();
  if (action.type === "quest") {
    return { speech: safeSpeechForAction(action, fallback), reason: "quest-card-speech" };
  }
  if (hasUnsafePublicRoleWord(trimmed)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "unsafe-role-word" };
  }
  if (isSchemaEcho(trimmed)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "schema-echo" };
  }
  if (isLowInformationSpeech(trimmed)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "low-information" };
  }
  if (contradictsVoteAction(trimmed, action)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "action-mismatch" };
  }

  return { speech: trimmed };
}

function hasUnsafePublicRoleWord(speech: string): boolean {
  return /\b(merlin|assassin|morgana|mordred|oberon|percival|minions?|loyal servant|magic)\b/iu.test(speech);
}

function isSchemaEcho(speech: string): boolean {
  return /<=\s*\d+\s*(?:chars?\s*)?public/iu.test(speech)
    || /\b(true\|false|success\|fail|pX)\b/u.test(speech);
}

function isLowInformationSpeech(speech: string): boolean {
  const normalized = speech.toLowerCase().replace(/\s+/gu, " ").trim();
  return normalized.length < 8
    || normalized === "vote yes"
    || normalized === "vote no"
    || normalized === "approve"
    || normalized === "reject"
    || /^(?:p\d+\s*[,;+ ]\s*)+p\d+$/iu.test(normalized);
}

function contradictsVoteAction(speech: string, action: LegalAction): boolean {
  if (action.type !== "vote") {
    return false;
  }

  const normalized = speech.toLowerCase();
  if (action.approve) {
    return /\b(reject(?:ing)?|avoid|prefer (?:a )?cleaner|rather (?:see|get|have) (?:a )?cleaner|before (?:greenlighting|backing)|do not like|don't like)\b/iu.test(normalized);
  }

  return /\b(approv(?:e|ing)|acceptable|looks reasonable|fine with|greenlight|backing this|voting yes)\b/iu.test(normalized);
}

function safeSpeechForAction(action: LegalAction, fallback: AiDecision): string {
  if (sameAction(action, fallback.action)) {
    return fallback.speech;
  }
  if (action.type === "proposeTeam") {
    return `I am proposing ${action.teamIds.join("+")} as a readable test.`;
  }
  if (action.type === "vote") {
    return action.approve ? "This team is acceptable for now." : "I want a cleaner proposal before approving.";
  }
  if (action.type === "quest") {
    return "I am resolving the quest.";
  }

  return "I think this player showed the clearest hidden guidance.";
}

function normalizeAiDecision(value: unknown): { speech: string | null; action: LegalAction } | null {
  const canonical = decisionSchema.safeParse(value);
  if (canonical.success) {
    return canonical.data;
  }

  const compact = compactDecisionSchema.safeParse(value);
  if (compact.success) {
    return {
      speech: compact.data.s,
      action: normalizeCompactAction(compact.data.a)
    };
  }

  const canonicalAction = actionSchema.safeParse(value);
  if (canonicalAction.success) {
    return { speech: null, action: canonicalAction.data };
  }

  const compactAction = compactActionSchema.safeParse(value);
  return compactAction.success ? { speech: null, action: normalizeCompactAction(compactAction.data) } : null;
}

function normalizeCompactAction(action: z.infer<typeof compactActionSchema>): LegalAction {
  if (action.t === "pt") {
    return { type: "proposeTeam", teamIds: action.ids };
  }
  if (action.t === "v") {
    return { type: "vote", approve: action.ok };
  }
  if (action.t === "q") {
    return { type: "quest", card: action.c };
  }
  return { type: "assassinate", targetId: action.id };
}

function summarizePublicState(state: GameState): string {
  const players = state.players.map((player) => `${player.id}@${player.seat + 1}${player.isHuman ? "H" : "A"}`).join(",");
  const quests = state.questResults.length
    ? state.questResults.map((quest, index) => `Q${index + 1}:${quest.teamIds.join("+")}:${quest.failCards}F:${quest.succeeded ? "S" : "F"}`).join(";")
    : "-";
  const proposal = state.proposal ? `${state.proposal.leaderId}>${state.proposal.teamIds.join("+")}` : "-";
  const votes = summarizeVotes(state);
  const questCards = summarizeQuestCardSubmissions(state);

  return [
    `S ph=${state.phase} q=${state.questIndex + 1} fv=${state.failedVotes} lead=${state.players[state.leaderIndex]?.id ?? "?"} prop=${proposal}`,
    `P=${players}`,
    votes,
    questCards,
    `H=${quests}`
  ].join("\n");
}

function summarizeVotes(state: GameState): string {
  const submitted = Object.keys(state.votes).length;
  if (state.phase === "voting" && submitted < state.playerCount) {
    return `V=${submitted}/${state.playerCount}:hidden`;
  }
  if (!submitted) {
    return "V=-";
  }

  return `V=${Object.entries(state.votes).map(([id, vote]) => `${id}:${vote ? "A" : "R"}`).join(",")}`;
}

function summarizeQuestCardSubmissions(state: GameState): string {
  const submitted = Object.keys(state.questCards).length;
  if (state.phase === "quest" && state.proposal) {
    return `QC=${submitted}/${state.proposal.teamIds.length}:hidden`;
  }
  return "QC=hidden;resolved_counts_only";
}

function summarizeTableTalk(tableTalk: PublicTalkEntry[]): string {
  if (!tableTalk.length) {
    return "TT -";
  }

  const recentTalk = tableTalk.slice(-12);
  return [
    "TT oldest>newest",
    ...recentTalk.map((entry, index) => `${index + 1}|${entry.speakerId}|${entry.speakerName}|${entry.text}`)
  ].join("\n");
}

function summarizeLegalActions(legalActions: LegalAction[]): string {
  const first = legalActions[0];
  if (!first) {
    return "LA none";
  }
  if (first.type === "proposeTeam") {
    const ids = [...new Set(legalActions.flatMap((action) => action.type === "proposeTeam" ? action.teamIds : []))].sort(comparePlayerIds);
    return `LA pt n=${first.teamIds.length} ids=${ids.join(",")}`;
  }
  if (first.type === "vote") {
    return `LA v ok=${legalActions.some((action) => action.type === "vote" && action.approve) ? 1 : 0} no=${legalActions.some((action) => action.type === "vote" && !action.approve) ? 1 : 0}`;
  }
  if (first.type === "quest") {
    const cards = legalActions.flatMap((action) => action.type === "quest" ? [action.card] : []);
    return `LA q c=${[...new Set(cards)].join("|")}`;
  }

  const targets = legalActions.flatMap((action) => action.type === "assassinate" ? [action.targetId] : []).sort(comparePlayerIds);
  return `LA as ids=${targets.join(",")}`;
}

function outputContract(actionKind: AiActionKind): string {
  if (actionKind === "proposeTeam") {
    return "OUT {\"s\":\"<=160 public\",\"a\":{\"t\":\"pt\",\"ids\":[\"pX\"]}}; ids from LA, exact n";
  }
  if (actionKind === "vote") {
    return "OUT {\"s\":\"<=160 public\",\"a\":{\"t\":\"v\",\"ok\":true}}; use false to reject";
  }
  if (actionKind === "quest") {
    return "OUT {\"s\":\"<=120 public\",\"a\":{\"t\":\"q\",\"c\":\"success\"}}; fail only if LA";
  }
  return "OUT {\"s\":\"<=160 public\",\"a\":{\"t\":\"as\",\"id\":\"pX\"}}; id from LA";
}

function compactList(ids: string[]): string {
  return ids.length ? ids.join(",") : "-";
}

function formatPersona(value: number): string {
  return value.toFixed(2);
}

function comparePlayerIds(left: string, right: string): number {
  return playerIdNumber(left) - playerIdNumber(right);
}

function playerIdNumber(playerId: string): number {
  const match = /^p(\d+)$/u.exec(playerId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
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
    return "full:history+votes+cover+Merlin-risk";
  }
  if (effort === "medium") {
    return "med:proposal+votes+quests";
  }

  return "fast:heuristic";
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
