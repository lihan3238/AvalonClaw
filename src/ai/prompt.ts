import { z } from "zod";
import { derivePublicFactsFromState, type PublicFacts } from "../game/publicFacts";
import { getRoleKnowledge } from "../game/rules";
import type { GameState, Player, Role } from "../game/types";
import type { AiActionKind, AiDecision, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiPromptMetrics, AiSpeechRepairReason, ChatMessage, LegalAction, Persona, PublicTalkEntry, ReasoningEffort, TableLanguage } from "./types";

const MAX_TABLE_TALK_CHARS = 180;
const ROLE_PROMPT_ORDER: Role[] = ["merlin", "percival", "loyal", "assassin", "morgana", "mordred", "oberon", "minion"];

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

interface ParseAiDecisionContext {
  playerId?: string;
}

interface ParsedAiDecision {
  speech: string | null;
  action: LegalAction;
  speechRepairReason?: AiSpeechRepairReason;
}

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("proposeTeam"), teamIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("speak") }),
  z.object({ type: z.literal("vote"), approve: voteChoiceSchema() }),
  z.object({ type: z.literal("quest"), card: z.enum(["success", "fail"]) }),
  z.object({ type: z.literal("assassinate"), targetId: z.string() })
]);

const decisionSchema = z.object({
  speech: z.string().trim().min(1),
  action: actionSchema
});

const compactNestedSpeechSchema = z.string().trim().min(1);

const compactActionSchema = z.union([
  z.object({ t: z.literal("pt"), ids: z.array(z.string()).min(1) }),
  z.object({
    t: z.literal("sp"),
    s: compactNestedSpeechSchema.optional(),
    text: compactNestedSpeechSchema.optional(),
    c: compactNestedSpeechSchema.optional()
  }),
  z.object({ t: z.literal("v"), ok: voteChoiceSchema().optional(), no: voteChoiceSchema().optional() })
    .refine((value) => value.ok !== undefined || value.no !== undefined),
  z.object({ t: z.literal("q"), c: z.enum(["success", "fail"]) }),
  z.object({ t: z.literal("as"), id: z.string() })
]);

const sloppyVoteActionSchema = z.union([
  z.object({
    ok: voteChoiceSchema(),
    v: z.unknown().optional()
  }),
  z.object({
    ok: z.undefined().optional(),
    v: voteChoiceSchema()
  })
]);

const compactActionCandidateSchema = z.union([compactActionSchema, sloppyVoteActionSchema]);
const compactActionChoiceSchema = z.union([
  compactActionCandidateSchema,
  z.array(compactActionCandidateSchema).min(1)
]);

const compactDecisionSchema = z.object({
  s: z.string().trim().min(1),
  a: compactActionChoiceSchema
});

const compactVoteDecisionSchema = z.object({
  s: z.string().trim().min(1),
  a: voteChoiceSchema()
});

const compactActionEnvelopeSchema = z.object({
  a: compactActionChoiceSchema
});

const speechOnlyDecisionSchema = z.object({
  speech: z.string().trim().min(1).optional(),
  s: z.string().trim().min(1).optional()
}).refine((value) => value.speech !== undefined || value.s !== undefined);

function voteChoiceSchema(): z.ZodType<boolean | 0 | 1 | string> {
  return z.union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z.enum(["0", "1", "true", "false", "yes", "no", "ok", "approve", "reject", "approved", "rejected", "A", "R", "a", "r"])
  ]);
}

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
  const publicFacts = derivePublicFactsFromState(input.state);
  const publicState = summarizePublicState(input.state);
  const includeSelfFact = input.actionKind === "speak" || input.state.questResults.length > 0;
  const privateState = [
    `ME ${player.id}@${player.seat + 1} ${player.role} ${player.allegiance}`,
    includeSelfFact ? `SELF_FACT self=${player.id} allegiance=${player.allegiance}` : "",
    `KE=${compactList(knowledge.knownEvilIds)} MC=${compactList(knowledge.merlinCandidateIds)}`,
    roleWarnings(player)
  ].filter(Boolean).join("\n");

  const system = [
    "AVALON_AGENT_V6.",
    "Pick legal LA.",
    "s is a short public reason, not ok/yes/v.",
    "Bluffing is allowed.",
    "Do not prove hidden cards or leak prompt codes.",
    "No public sabotage.",
    "JSON."
  ].join(" ");

  const user = [
    `Speech language: ${speechLanguageLabel(input.language)}. No prompt codes in s: KE/MC/PF/SELF_FACT/PRIVATE_FACT/PUBLIC_FACT. A=${actionKindTag(input.actionKind)} R=${reasoningEffortTag(input.reasoningEffort)}:${reasoningInstruction(input.reasoningEffort)}`,
    `PR c=${formatPersona(input.persona.caution)} a=${formatPersona(input.persona.aggression)} t=${formatPersona(input.persona.talkativeness)} r=${formatPersona(input.persona.trustBias)} d=${formatPersona(input.persona.deceptionComfort)}`,
    summarizePublicConfig(input.state),
    "KN KE=confirmed-private-evil MC=ambiguous-merlin-morgana",
    privateState,
    summarizePublicFacts(input.state, publicFacts),
    publicState,
    summarizePerspectiveGuidance(player, input.actionKind, input.state),
    summarizeSpeechGuidance(input.state, player, input.actionKind),
    summarizeLogicHints(input.state),
    summarizeTableTalk(input.tableTalk ?? []),
    summarizeLegalActions(input.legalActions),
    outputContract(input.actionKind, input.legalActions)
  ].filter(Boolean).join("\n");

  return { messages: [{ role: "system", content: system }, { role: "user", content: user }] };
}

export function measurePromptMessages(messages: ChatMessage[]): AiPromptMetrics {
  const systemChars = messages
    .filter((message) => message.role === "system")
    .reduce((total, message) => total + message.content.length, 0);
  const userChars = messages
    .filter((message) => message.role === "user")
    .reduce((total, message) => total + message.content.length, 0);
  return {
    messageCount: messages.length,
    systemChars,
    userChars,
    totalChars: systemChars + userChars
  };
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

export function parseAiDecision(raw: string, legalActions: LegalAction[], fallback: AiDecision, context: ParseAiDecisionContext = {}): AiDecisionResult {
  const json = extractJsonObject(raw);
  if (!json) {
    return fallbackDecision(fallback, "invalid-json", "no-json-object");
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return fallbackDecision(fallback, "invalid-json", "malformed-json");
  }

  const parsed = normalizeAiDecision(value);
  if (!parsed && legalActions.length === 1) {
    const speechOnly = normalizeSpeechOnlyDecision(value, legalActions[0]);
    if (speechOnly) {
      return modelDecisionFromParsed(speechOnly, fallback, context);
    }
  }
  if (!parsed) {
    return fallbackDecision(fallback, "invalid-json", "invalid-decision-shape");
  }
  if (!legalActions.some((action) => sameAction(action, parsed.action))) {
    if (legalActions.length === 1 && legalActions[0].type === "speak" && parsed.speech !== null) {
      return modelDecisionFromParsed({
        ...parsed,
        action: legalActions[0],
        speechRepairReason: parsed.speechRepairReason ?? "forced-legal-action"
      }, fallback, context);
    }
    return fallbackDecision(fallback, "illegal-action", "illegal-action");
  }

  return modelDecisionFromParsed(parsed, fallback, context);
}

function modelDecisionFromParsed(parsed: ParsedAiDecision, fallback: AiDecision, context: ParseAiDecisionContext): AiDecisionResult {
  const repaired = parsed.speech === null
    ? { speech: safeSpeechForAction(parsed.action, fallback), reason: "missing-speech" as const }
    : repairPublicSpeech(parsed.speech, parsed.action, fallback, context);
  const speechRepairReason = repaired.reason ?? parsed.speechRepairReason;
  return {
    speech: repaired.speech,
    action: parsed.action,
    source: "model",
    ...(speechRepairReason ? { speechRepairReason } : {})
  };
}

export function sameAction(left: LegalAction, right: LegalAction): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "proposeTeam" && right.type === "proposeTeam") {
    return sameTeam(left.teamIds, right.teamIds);
  }
  if (left.type === "speak" && right.type === "speak") {
    return true;
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

function fallbackDecision(fallback: AiDecision, fallbackReason: AiFallbackReason, fallbackDetail?: AiFallbackDetail): AiDecisionResult {
  return { ...fallback, source: "fallback", fallbackReason, ...(fallbackDetail ? { fallbackDetail } : {}) };
}

function repairPublicSpeech(speech: string, action: LegalAction, fallback: AiDecision, context: ParseAiDecisionContext): { speech: string; reason?: AiSpeechRepairReason } {
  const cleaned = compactWhitespace(speech);
  if (action.type === "quest") {
    return { speech: safeSpeechForAction(action, fallback), reason: "quest-card-speech" };
  }
  if (hasUnsafePublicRoleWord(cleaned)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "unsafe-role-word" };
  }
  if (hasSecretIntentLeak(cleaned, context.playerId)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "secret-intent-leak" };
  }
  if (isSchemaEcho(cleaned)) {
    return { speech: safeSpeechForAction(action, fallback), reason: "schema-echo" };
  }

  return { speech: cleaned };
}

function hasUnsafePublicRoleWord(speech: string): boolean {
  return /\b(?:ke|mc)\b/iu.test(speech)
    || /\b(?:PF|SELF_FACT|PRIVATE_FACT|PUBLIC_FACT)\b/u.test(speech)
    || /\b(?:confirmed-private-evil|ambiguous-merlin-morgana)\b/iu.test(speech);
}

function hasSecretIntentLeak(speech: string, playerId?: string): boolean {
  return /(?:保留|留下|制造|创造|方便|准备|保住).{0,8}(?:破坏|失败牌|坏票)/u.test(speech)
    || /(?:可破坏位|破坏空间|破坏机会|作恶能力|作恶空间|作恶机会|可操作位|出坏票|出失败牌|投失败|打失败|交失败)/u.test(speech)
    || /\b(?:sabotage path|sabotage window|sabotage-capable|room to sabotage|play fail|submit fail|keep \w+ sabotage|create \w+ sabotage)\b/iu.test(speech)
    || hasSelfSideLeak(speech, playerId);
}

function hasSelfSideLeak(speech: string, playerId?: string): boolean {
  if (hasUnnegatedSelfSideTerm(speech, "(?:我|本人|自己)")) {
    return true;
  }
  if (!playerId) {
    return false;
  }

  const seat = /^p(\d+)$/u.exec(playerId)?.[1];
  const selfIdPattern = seat ? `(?:p\\s*${seat}|${seat}\\s*号?)` : escapeRegExp(playerId);
  return hasUnnegatedSelfSideTerm(speech, selfIdPattern);
}

function hasUnnegatedSelfSideTerm(speech: string, selfRefPattern: string): boolean {
  const termPattern = "(?:坏人|反派|邪恶|恶阵营|作恶阵营|evil|spy|minion)";
  const pattern = new RegExp(`${selfRefPattern}([^。！？!?，,；;\\n]{0,14})${termPattern}`, "giu");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(speech)) !== null) {
    const context = match[1];
    if (!/(?:不是|并非|不算|没有|没|无|非|not|no|never)/iu.test(context)
      && !/(?:p\s*(?:10|[1-9])|(?:10|[1-9])\s*号|他|她|ta|别人)/iu.test(context)) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function speechLanguageLabel(language?: TableLanguage): string {
  return language === "zh" ? "Chinese" : "English";
}

function isSchemaEcho(speech: string): boolean {
  const normalized = speech.toLowerCase().replace(/\s+/gu, " ").trim();
  return /<=\s*\d+\s*(?:chars?\s*)?public/iu.test(speech)
    || /\bpub\s*<=\s*\d+\b/iu.test(speech)
    || /\bown[_\s-]*public[_\s-]*reason\b/iu.test(speech)
    || /\b(true\|false|success\|fail|pX)\b/u.test(speech)
    || ["<reason>", "why team", "vote why", "target read", "resolve", "i can back this.", "i can't back this.", "i like this test."].includes(normalized);
}

function safeSpeechForAction(action: LegalAction, fallback: AiDecision): string {
  if (sameAction(action, fallback.action)) {
    return fallback.speech;
  }
  const useChinese = fallbackUsesChinese(fallback);
  if (action.type === "proposeTeam") {
    return useChinese ? `我提议 ${action.teamIds.join("+")}，先做一个清晰检验。` : `I am proposing ${action.teamIds.join("+")} as a readable test.`;
  }
  if (action.type === "speak") {
    return useChinese ? "我先看队伍和前面发言的矛盾点。" : "I am weighing the proposal against the public reads so far.";
  }
  if (action.type === "vote") {
    if (useChinese) {
      return action.approve ? "这队目前可以接受。" : "我想先看一个更干净的提案。";
    }
    return action.approve ? "This team is acceptable for now." : "I want a cleaner proposal before approving.";
  }
  if (action.type === "quest") {
    return useChinese ? "我来处理这次任务。" : "I am resolving the quest.";
  }

  return useChinese ? "我认为这个人最像在暗中带队。" : "I think this player showed the clearest hidden guidance.";
}

function fallbackUsesChinese(fallback: AiDecision): boolean {
  return /\p{Script=Han}/u.test(fallback.speech);
}

function normalizeAiDecision(value: unknown): ParsedAiDecision | null {
  const wrapped = unwrapDecisionValue(value);
  if (wrapped !== null) {
    const parsed = normalizeAiDecision(wrapped);
    if (parsed) {
      return parsed;
    }
  }

  const canonical = decisionSchema.safeParse(value);
  if (canonical.success) {
    return {
      speech: canonical.data.speech,
      action: normalizeCanonicalAction(canonical.data.action)
    };
  }

  const compact = compactDecisionSchema.safeParse(value);
  if (compact.success) {
    const speech = normalizeCompactSpeech(compact.data.s, compact.data.a);
    return {
      speech: speech.speech,
      ...(speech.reason ? { speechRepairReason: speech.reason } : {}),
      action: normalizeCompactAction(compact.data.a)
    };
  }

  const compactVote = compactVoteDecisionSchema.safeParse(value);
  if (compactVote.success) {
    return {
      speech: compactVote.data.s,
      action: { type: "vote", approve: normalizeVoteChoice(compactVote.data.a) }
    };
  }

  const canonicalAction = actionSchema.safeParse(value);
  if (canonicalAction.success) {
    return { speech: null, action: normalizeCanonicalAction(canonicalAction.data) };
  }

  const compactEnvelope = compactActionEnvelopeSchema.safeParse(value);
  if (compactEnvelope.success) {
    return { speech: null, action: normalizeCompactAction(compactEnvelope.data.a) };
  }

  const compactAction = compactActionSchema.safeParse(value);
  return compactAction.success
    ? { speech: nestedCompactSpeech(compactAction.data), action: normalizeCompactAction(compactAction.data) }
    : null;
}

function unwrapDecisionValue(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["out", "output", "decision"] as const) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return null;
}

function normalizeSpeechOnlyDecision(value: unknown, action: LegalAction): ParsedAiDecision | null {
  const speechOnly = speechOnlyDecisionSchema.safeParse(value);
  return speechOnly.success ? { speech: speechOnly.data.speech ?? speechOnly.data.s ?? "", action } : null;
}

function normalizeCompactSpeech(
  topLevelSpeech: string,
  action: z.infer<typeof compactActionChoiceSchema>
): { speech: string; reason?: AiSpeechRepairReason } {
  const nestedSpeech = nestedCompactSpeech(action);
  if (nestedSpeech && shouldPreferNestedSpeech(topLevelSpeech, nestedSpeech)) {
    return { speech: nestedSpeech, reason: "nested-speech" };
  }
  return { speech: topLevelSpeech };
}

function nestedCompactSpeech(action: z.infer<typeof compactActionChoiceSchema>): string | null {
  const firstAction = firstCompactAction(action);
  if (!("t" in firstAction) || firstAction.t !== "sp") {
    return null;
  }
  return firstAction.s ?? firstAction.text ?? firstAction.c ?? null;
}

function shouldPreferNestedSpeech(topLevelSpeech: string, nestedSpeech: string): boolean {
  const top = compactWhitespace(topLevelSpeech);
  const nested = compactWhitespace(nestedSpeech);
  if (nested.length < 8 || isSchemaEcho(nested)) {
    return false;
  }
  return /^(?:中文|英文)?\s*(?:简短)?(?:公开)?(?:发言|理由|说明|表态|回复)[，,：:]/u.test(top)
    || /(?:保留|强调|给出|说明|表达|指出).{0,18}(?:思路|理由|判断|态度|观点|验证)/u.test(top)
    || /^(?:brief|short)\s+(?:public\s+)?(?:speech|reason|statement)\b/iu.test(top);
}

function normalizeCanonicalAction(action: z.infer<typeof actionSchema>): LegalAction {
  if (action.type === "vote") {
    return { type: "vote", approve: normalizeVoteChoice(action.approve) };
  }
  return action;
}

function normalizeCompactAction(action: z.infer<typeof compactActionChoiceSchema>): LegalAction {
  const firstAction = firstCompactAction(action);
  if (!("t" in firstAction)) {
    return { type: "vote", approve: normalizeVoteChoice(firstAction.ok !== undefined ? firstAction.ok : firstAction.v) };
  }
  if (firstAction.t === "pt") {
    return { type: "proposeTeam", teamIds: firstAction.ids };
  }
  if (firstAction.t === "sp") {
    return { type: "speak" };
  }
  if (firstAction.t === "v") {
    if (firstAction.ok !== undefined) {
      return { type: "vote", approve: normalizeVoteChoice(firstAction.ok) };
    }
    return { type: "vote", approve: firstAction.no !== undefined ? !normalizeVoteChoice(firstAction.no) : false };
  }
  if (firstAction.t === "q") {
    return { type: "quest", card: firstAction.c };
  }
  return { type: "assassinate", targetId: firstAction.id };
}

function firstCompactAction(action: z.infer<typeof compactActionChoiceSchema>): z.infer<typeof compactActionCandidateSchema> {
  return Array.isArray(action) ? action[0] : action;
}

function normalizeVoteChoice(value: boolean | 0 | 1 | string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }

  return ["true", "yes", "ok", "approve", "approved", "a"].includes(value.toLowerCase());
}

function summarizePublicFacts(state: GameState, facts: PublicFacts): string {
  if (!state.questResults.length) {
    return "";
  }
  return [
    `PF hardGood=${compactList(facts.publicGood)} hardEvil=${compactList(facts.publicEvil)}`,
    `PF worlds=${facts.possibleWorldCount} constraints=${facts.constraints.join(";")}`,
    "PUBLIC_FACT only PF hardGood/hardEvil; SELF_FACT/PRIVATE_FACT must not be called public information",
    "SOFT_READ TT/votes/persona are guesses only; never upgrade them to public-good/public-evil"
  ].join("\n");
}

function summarizePublicConfig(state: GameState): string {
  const goodCount = state.players.filter((player) => player.allegiance === "good").length;
  const evilCount = state.players.length - goodCount;
  const roleCounts = new Map<Role, number>();
  for (const player of state.players) {
    roleCounts.set(player.role, (roleCounts.get(player.role) ?? 0) + 1);
  }
  const roles = ROLE_PROMPT_ORDER
    .flatMap((role) => {
      const count = roleCounts.get(role) ?? 0;
      if (!count) {
        return [];
      }
      return count === 1 ? [role] : [`${role}x${count}`];
    })
    .join(",");

  return `CFG n=${state.playerCount} good=${goodCount} evil=${evilCount} roles=${roles}`;
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
    `G ph=${state.phase} q=${state.questIndex + 1} fv=${state.failedVotes} l=${state.players[state.leaderIndex]?.id ?? "?"} pr=${proposal}`,
    summarizeDiscussion(state),
    `P=${players}`,
    votes,
    questCards,
    `H=${quests}`
  ].join("\n");
}

function summarizeDiscussion(state: GameState): string {
  if (state.phase !== "discussion" || !state.discussion) {
    return "D=-";
  }

  const nextSpeaker = state.players[state.discussion.nextSpeakerIndex]?.id ?? "?";
  const order = state.players.map((player) => player.id).join(",");
  return `D next=${nextSpeaker} spoken=${compactList(state.discussion.spokenIds)} order=${order}`;
}

function summarizeLogicHints(state: GameState): string {
  return state.questResults.length
    ? [
      "CHECK before JSON: use PF hardGood/hardEvil as 100% facts; everything else is SOFT_READ unless LG proves it",
      "LG zero-fail: 0F never proves quest team public-good; evil can play success to hide",
      "LG no no-evil: never call 0F/partial results known-no-evil or known-safe unless LG hard fact proves public-good",
      "LG no reliability-cert: avoid known/verified/public/certain reliability wording unless PF hardGood proves it",
      "LG failCards==teamSize => quest team all public-evil; failCards==CFG evil => outside quest public-good; apply before soft reads",
      "LG exact evil-count but not all-fail: outside quest public-good only; quest team has exactly failCards evil, not all public-evil",
      "LG exact example: 3-player team 2F with evil=2 => off-team public-good; on-team has exactly 2 evil + 1 good, never whole-team evil",
      "LG whole-team evil only when failCards==teamSize; never call 2F on 3 players whole-team evil",
      "LG partial fail: 0<failCards<teamSize and failCards<CFG evil => only at-least-one-on-team; no public-good/public-evil",
      "LG partial wording: say 至少一坏/at least one evil; never say 已知有1坏 or exactly-one unless LG exact evil-count says so",
      "LG partial outside: if failCards<CFG evil, off-team players are not public-good; call them untested/off-team, not clean/good",
      "LG example partial: team A+B 1F with evil=2 => A/B has >=1 evil; C/D/E are untested, never public-good",
      "LG group-count: exact/at-least evil counts are set facts; never lock a single player evil/good unless PF hardEvil/hardGood names that player",
      "LG no score-wash: history/score can create suspicion only; do not call score-made good/clean unless LG hard fact",
      "LG HARD use PF hardGood/hardEvil before every action; forced public facts beat trust/stable/clean words",
      "LG speech guard: say likely/read/suspicion unless LG hard fact proves public-good/public-evil"
    ].join("\n")
    : "LG -";
}

function summarizePerspectiveGuidance(player: Player, actionKind: AiActionKind, state: GameState): string {
  if (actionKind !== "speak" && !state.questResults.length) {
    return "";
  }
  const surface = actionKind === "speak" ? "speech" : "public reason";
  if (player.allegiance !== "good") {
    return `VIEW ${surface}: keep SELF_FACT/PRIVATE_FACT internal; public claims need PF hardGood/hardEvil or soft-read wording`;
  }
  if (actionKind !== "speak") {
    return `VIEW public reason: self-known good is private perspective; say from my view/from ${player.id} view, never 已知好人/known-good ${player.id} unless PF hardGood proves it`;
  }
  return `VIEW speech: self-known good is private perspective; say from my view/from ${player.id} view, never public-known ${player.id} good`;
}

function formatTeamList(teams: string[][], maxTeams = 4, includeOverflow = true): string {
  const shown = teams.slice(0, maxTeams).map((team) => team.join("+")).join("|");
  return includeOverflow && teams.length > maxTeams ? `${shown}|...+${teams.length - maxTeams}` : shown;
}

function summarizeSpeechGuidance(state: GameState, player: Player, actionKind: AiActionKind): string {
  if (actionKind !== "speak" || state.phase !== "discussion" || !state.proposal) {
    return "";
  }
  const prTeam = state.proposal.teamIds.join("+");
  const teamSize = state.proposal.teamIds.length;
  if (state.proposal.leaderId === player.id) {
    return `SP leader prTeam=${prTeam} size=${teamSize}; explain exactly this team, do not add/remove/self-insert`;
  }

  return `SP prTeam=${prTeam} size=${teamSize}; discuss current pr; label alternative teams as alternatives`;
}

function summarizeVotes(state: GameState): string {
  const submitted = Object.keys(state.votes).length;
  if (state.phase === "voting" && submitted < state.playerCount) {
    return `V=${submitted}/${state.playerCount}:hidden`;
  }
  if (!submitted) {
    return "V=-";
  }

  return `V=${Object.entries(state.votes).map(([id, vote]) => `${id}:${vote === "approve" ? "A" : "R"}`).join(",")}`;
}

function summarizeQuestCardSubmissions(state: GameState): string {
  const submitted = Object.keys(state.questCards).length;
  if (state.phase === "quest" && state.proposal) {
    return `QC=${submitted}/${state.proposal.teamIds.length}:*`;
  }
  return "QC=*";
}

function summarizeTableTalk(tableTalk: PublicTalkEntry[]): string {
  if (!tableTalk.length) {
    return "TT -";
  }

  const recentTalk = tableTalk.slice(-12);
  return [
    "TT o>n",
    "TT soft public claims only; use speaker claims for pressure, not truth",
    ...recentTalk.map((entry, index) => `${index + 1}|${entry.speakerId}|${compactTalkText(entry.text)}`)
  ].join("\n");
}

function compactTalkText(text: string): string {
  return clipText(compactWhitespace(text), MAX_TABLE_TALK_CHARS);
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function clipText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}

function summarizeLegalActions(legalActions: LegalAction[]): string {
  const first = legalActions[0];
  if (!first) {
    return "LA none";
  }
  if (first.type === "proposeTeam") {
    const teams = legalActions.flatMap((action) => action.type === "proposeTeam" ? [action.teamIds] : []);
    if (teams.length > 24) {
      const ids = [...new Set(teams.flat())].sort(comparePlayerIds);
      return `LA pt n=${first.teamIds.length} ids=${ids.join(",")} sampleTeams=${formatTeamList(teams, 3, false)} total=${teams.length}`;
    }
    return `LA pt n=${first.teamIds.length} teams=${formatTeamList(teams, 24)}`;
  }
  if (first.type === "speak") {
    return "LA sp";
  }
  if (first.type === "vote") {
    return `LA v ok=${legalActions.some((action) => action.type === "vote" && action.approve) ? 1 : 0} no=${legalActions.some((action) => action.type === "vote" && !action.approve) ? 1 : 0}`;
  }
  if (first.type === "quest") {
    const cards = legalActions.flatMap((action) => action.type === "quest" ? [action.card] : []);
    return `LA q c=${[...new Set(cards)].join("|")}`;
  }

  const targets = legalActions.flatMap((action) => action.type === "assassinate" ? [action.targetId] : []).sort(comparePlayerIds);
  return [
    `LA as ids=${targets.join(",")}`,
    "AS choose one id from LA as ids; never output a list/team/comma string"
  ].join("\n");
}

function outputContract(actionKind: AiActionKind, legalActions: LegalAction[]): string {
  if (actionKind === "proposeTeam") {
    const size = legalActions.find((action) => action.type === "proposeTeam")?.teamIds.length ?? "?";
    return `OUT JSON keys=s,a a={\"t\":\"pt\",\"ids\":[\"pX\"]} n=${size}\nPT choose listed complete team; len(ids)=n`;
  }
  if (actionKind === "speak") {
    return "OUT JSON keys=s,a a={\"t\":\"sp\"}";
  }
  if (actionKind === "vote") {
    return "OUT JSON keys=s,a a={\"t\":\"v\",\"ok\":1} 0=reject";
  }
  if (actionKind === "quest") {
    return "OUT JSON keys=s,a a={\"t\":\"q\",\"c\":\"success\"} fail iff LA";
  }
  return "OUT JSON keys=s,a a={\"t\":\"as\",\"id\":\"pX\"} one target only";
}

function compactList(ids: string[]): string {
  return ids.length ? ids.join(",") : "-";
}

function formatPersona(value: number): string {
  return Math.round(value * 99).toString();
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
    return "RW mh subtle coverA";
  }
  if (player.role === "percival") {
    return "RW mc? coverM";
  }
  if (player.allegiance === "evil") {
    return "RW bluff LA";
  }

  return "RW pub inferVQ";
}

function reasoningInstruction(effort: ReasoningEffort): string {
  if (effort === "xhigh") {
    return "deep hist+votes+cover+M?";
  }
  if (effort === "high") {
    return "hist+votes+cover+M?";
  }
  if (effort === "medium") {
    return "prop+votes+quests";
  }

  return "fast";
}

function actionKindTag(actionKind: AiActionKind): string {
  if (actionKind === "proposeTeam") {
    return "pt";
  }
  if (actionKind === "speak") {
    return "sp";
  }
  if (actionKind === "vote") {
    return "v";
  }
  if (actionKind === "quest") {
    return "q";
  }
  return "as";
}

function reasoningEffortTag(effort: ReasoningEffort): string {
  if (effort === "xhigh") {
    return "x";
  }
  if (effort === "high") {
    return "h";
  }
  if (effort === "medium") {
    return "m";
  }
  return "l";
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
