import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AiActionKind, AiApiTiming, AiApiUsage, AiDecisionResult, AiFallbackDetail, AiFallbackReason, AiPromptMetrics, AiSpeechRepairReason, LegalAction, ReasoningEffort } from "../src/ai/types";
import { derivePublicFacts } from "../src/game/publicFacts";
import type { QuestResult } from "../src/game/types";

export type RealApiTraceModelTier = "strong" | "weak" | "uniform";

export interface RealApiTraceEntry {
  actionKind: AiActionKind;
  source: AiDecisionResult["source"];
  fallbackReason?: AiFallbackReason;
  fallbackDetail?: AiFallbackDetail;
  speechRepairReason?: AiSpeechRepairReason;
  modelTier: RealApiTraceModelTier;
  requestedReasoningEffort?: ReasoningEffort;
  reasoningEffort?: ReasoningEffort;
  promptMetrics?: AiPromptMetrics;
  apiUsage?: AiApiUsage;
  apiTiming?: AiApiTiming;
}

export interface RealApiNumberSummary {
  count: number;
  min: number;
  max: number;
  total: number;
  average: number;
}

export interface RealApiUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  reasoningTokens: number;
}

export interface RealApiTraceDiagnostics {
  steps: number;
  modelActions: number;
  localActions: number;
  fallbackCount: number;
  fallbacksByReason: Partial<Record<AiFallbackReason, number>>;
  fallbacksByDetail: Partial<Record<AiFallbackDetail, number>>;
  fallbacksByActionKind: Partial<Record<AiActionKind, number>>;
  fallbacksByModelTier: Partial<Record<RealApiTraceModelTier, number>>;
  fallbacksByReasoningEffort: Partial<Record<ReasoningEffort, number>>;
  fallbacksByRequestedReasoningEffort: Partial<Record<ReasoningEffort, number>>;
  promptChars?: RealApiNumberSummary;
  promptCharsByActionKind: Partial<Record<AiActionKind, RealApiNumberSummary>>;
  apiUsageTotals: RealApiUsageTotals;
  apiTiming?: RealApiNumberSummary;
  apiAttempts: number;
  apiTimingBySource: Partial<Record<AiDecisionResult["source"], RealApiNumberSummary>>;
  apiAttemptsBySource: Partial<Record<AiDecisionResult["source"], number>>;
  apiTimingByFallbackReason: Partial<Record<AiFallbackReason, RealApiNumberSummary>>;
  apiAttemptsByFallbackReason: Partial<Record<AiFallbackReason, number>>;
  localByActionKind: Partial<Record<AiActionKind, number>>;
  speechRepairsByReason: Partial<Record<AiSpeechRepairReason, number>>;
}

type RealApiAuditAllegiance = "good" | "evil";

export interface RealApiAuditModelAssignment {
  playerId: string;
  allegiance: RealApiAuditAllegiance;
}

export interface RealApiAuditTraceEntry extends RealApiTraceEntry {
  step: number;
  playerId: string;
  action: LegalAction;
  speech: string;
}

export interface RealApiAuditIssue {
  step: number;
  playerId: string;
  teamIds?: string[];
  speech?: string;
}

export interface RealApiGameAudit {
  publicFacts: {
    publicEvil: string[];
    publicGood: string[];
  };
  allPublicGoodEvilProposals: RealApiAuditIssue[];
  evilApproveAllPublicGoodTeams: RealApiAuditIssue[];
  evilApproveNoTrueEvilTeams: RealApiAuditIssue[];
  evilNonPivotalApproveAllPublicGoodTeams: RealApiAuditIssue[];
  evilNonPivotalApproveNoTrueEvilTeams: RealApiAuditIssue[];
  goodApprovePublicEvilTeams: RealApiAuditIssue[];
  goodProposePublicEvilTeams: RealApiAuditIssue[];
  unrepairedSecretLeaks: RealApiAuditIssue[];
  promptCodeLeaks: RealApiAuditIssue[];
  publicFactOverclaims: RealApiAuditIssue[];
}

export function summarizeRealApiTrace(trace: RealApiTraceEntry[]): RealApiTraceDiagnostics {
  const promptChars = createNumberAccumulator();
  const apiTiming = createNumberAccumulator();
  const promptCharsByActionKind: Partial<Record<AiActionKind, NumberAccumulator>> = {};
  const apiTimingBySource: Partial<Record<AiDecisionResult["source"], NumberAccumulator>> = {};
  const apiTimingByFallbackReason: Partial<Record<AiFallbackReason, NumberAccumulator>> = {};
  const diagnostics: RealApiTraceDiagnostics = {
    steps: trace.length,
    modelActions: 0,
    localActions: 0,
    fallbackCount: 0,
    fallbacksByReason: {},
    fallbacksByDetail: {},
    fallbacksByActionKind: {},
    fallbacksByModelTier: {},
    fallbacksByReasoningEffort: {},
    fallbacksByRequestedReasoningEffort: {},
    promptCharsByActionKind: {},
    apiUsageTotals: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedPromptTokens: 0,
      reasoningTokens: 0
    },
    apiAttempts: 0,
    apiTimingBySource: {},
    apiAttemptsBySource: {},
    apiTimingByFallbackReason: {},
    apiAttemptsByFallbackReason: {},
    localByActionKind: {},
    speechRepairsByReason: {}
  };

  for (const entry of trace) {
    if (entry.promptMetrics) {
      addNumber(promptChars, entry.promptMetrics.totalChars);
      const actionPromptChars = promptCharsByActionKind[entry.actionKind] ?? createNumberAccumulator();
      addNumber(actionPromptChars, entry.promptMetrics.totalChars);
      promptCharsByActionKind[entry.actionKind] = actionPromptChars;
    }
    if (entry.apiUsage) {
      addUsage(diagnostics.apiUsageTotals, entry.apiUsage);
    }
    if (entry.apiTiming) {
      addNumber(apiTiming, entry.apiTiming.durationMs);
      diagnostics.apiAttempts += entry.apiTiming.attempts;
      addNumberForKey(apiTimingBySource, entry.source, entry.apiTiming.durationMs);
      addCount(diagnostics.apiAttemptsBySource, entry.source, entry.apiTiming.attempts);
      if (entry.fallbackReason) {
        addNumberForKey(apiTimingByFallbackReason, entry.fallbackReason, entry.apiTiming.durationMs);
        addCount(diagnostics.apiAttemptsByFallbackReason, entry.fallbackReason, entry.apiTiming.attempts);
      }
    }

    if (entry.source === "fallback") {
      diagnostics.fallbackCount += 1;
      increment(diagnostics.fallbacksByActionKind, entry.actionKind);
      increment(diagnostics.fallbacksByModelTier, entry.modelTier);
      if (entry.fallbackReason) {
        increment(diagnostics.fallbacksByReason, entry.fallbackReason);
      }
      if (entry.fallbackDetail) {
        increment(diagnostics.fallbacksByDetail, entry.fallbackDetail);
      }
      if (entry.reasoningEffort) {
        increment(diagnostics.fallbacksByReasoningEffort, entry.reasoningEffort);
      }
      if (entry.requestedReasoningEffort) {
        increment(diagnostics.fallbacksByRequestedReasoningEffort, entry.requestedReasoningEffort);
      }
    } else if (entry.source === "local") {
      diagnostics.localActions += 1;
      increment(diagnostics.localByActionKind, entry.actionKind);
    } else {
      diagnostics.modelActions += 1;
    }

    if (entry.speechRepairReason) {
      increment(diagnostics.speechRepairsByReason, entry.speechRepairReason);
    }
  }

  if (promptChars.count) {
    diagnostics.promptChars = summarizeNumbers(promptChars);
  }
  if (apiTiming.count) {
    diagnostics.apiTiming = summarizeNumbers(apiTiming);
  }
  for (const [actionKind, accumulator] of Object.entries(promptCharsByActionKind) as Array<[AiActionKind, NumberAccumulator]>) {
    diagnostics.promptCharsByActionKind[actionKind] = summarizeNumbers(accumulator);
  }
  for (const [source, accumulator] of Object.entries(apiTimingBySource) as Array<[AiDecisionResult["source"], NumberAccumulator]>) {
    diagnostics.apiTimingBySource[source] = summarizeNumbers(accumulator);
  }
  for (const [reason, accumulator] of Object.entries(apiTimingByFallbackReason) as Array<[AiFallbackReason, NumberAccumulator]>) {
    diagnostics.apiTimingByFallbackReason[reason] = summarizeNumbers(accumulator);
  }

  return diagnostics;
}

export function appendRealApiResultJsonl(outputPath: string, result: unknown): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(result)}\n`, "utf8");
}

export function auditRealApiGame(input: {
  modelAssignments: RealApiAuditModelAssignment[];
  trace: RealApiAuditTraceEntry[];
}): RealApiGameAudit {
  const byId = new Map(input.modelAssignments.map((assignment) => [assignment.playerId, assignment]));
  const evilIds = new Set(input.modelAssignments.filter((assignment) => assignment.allegiance === "evil").map((assignment) => assignment.playerId));
  const playerIds = input.modelAssignments.map((assignment) => assignment.playerId);
  const publicEvil = new Set<string>();
  const publicGood = new Set<string>();
  let activeProposal: string[] = [];
  let pendingQuest: RealApiAuditTraceEntry[] = [];
  let questResults: QuestResult[] = [];
  const audit: RealApiGameAudit = {
    publicFacts: {
      publicEvil: [],
      publicGood: []
    },
    allPublicGoodEvilProposals: [],
    evilApproveAllPublicGoodTeams: [],
    evilApproveNoTrueEvilTeams: [],
    evilNonPivotalApproveAllPublicGoodTeams: [],
    evilNonPivotalApproveNoTrueEvilTeams: [],
    goodApprovePublicEvilTeams: [],
    goodProposePublicEvilTeams: [],
    unrepairedSecretLeaks: [],
    promptCodeLeaks: [],
    publicFactOverclaims: []
  };

  let pendingVotes: RealApiAuditTraceEntry[] = [];
  const finalizePendingVotes = () => {
    if (!pendingVotes.length || !activeProposal.length) {
      pendingVotes = [];
      return;
    }

    const approvalThreshold = Math.floor(playerIds.length / 2) + 1;
    const approveVotes = pendingVotes.filter((entry) => entry.action.type === "vote" && entry.action.approve);
    const evilApproveVotes = approveVotes.filter((entry) => byId.get(entry.playerId)?.allegiance === "evil");
    const evilApprovalsNeededToPass = approveVotes.length >= approvalThreshold
      && approveVotes.length - evilApproveVotes.length < approvalThreshold;

    for (const vote of approveVotes) {
      const assignment = byId.get(vote.playerId);
      if (assignment?.allegiance === "evil" && isAllInSet(activeProposal, publicGood)) {
        const issue = { step: vote.step, playerId: vote.playerId, teamIds: [...activeProposal] };
        if (evilApprovalsNeededToPass) {
          audit.evilApproveAllPublicGoodTeams.push(issue);
        } else {
          audit.evilNonPivotalApproveAllPublicGoodTeams.push(issue);
        }
      }
      if (assignment?.allegiance === "evil" && !hasAnyInSet(activeProposal, evilIds)) {
        const issue = { step: vote.step, playerId: vote.playerId, teamIds: [...activeProposal] };
        if (evilApprovalsNeededToPass) {
          audit.evilApproveNoTrueEvilTeams.push(issue);
        } else {
          audit.evilNonPivotalApproveNoTrueEvilTeams.push(issue);
        }
      }
      if (assignment?.allegiance === "good" && hasAnyInSet(activeProposal, publicEvil)) {
        audit.goodApprovePublicEvilTeams.push({ step: vote.step, playerId: vote.playerId, teamIds: [...activeProposal] });
      }
    }

    pendingVotes = [];
  };

  for (const entry of input.trace) {
    if (entry.action.type !== "vote" && pendingVotes.length) {
      finalizePendingVotes();
    }

    if (entry.actionKind !== "quest" && pendingQuest.length) {
      questResults = applyQuestFacts(pendingQuest, playerIds, evilIds.size, publicEvil, publicGood, questResults);
      pendingQuest = [];
    }

    const assignment = byId.get(entry.playerId);
    if (entry.action.type === "proposeTeam") {
      activeProposal = [...entry.action.teamIds];
      if (assignment?.allegiance === "evil" && isAllInSet(entry.action.teamIds, publicGood)) {
        audit.allPublicGoodEvilProposals.push({ step: entry.step, playerId: entry.playerId, teamIds: [...entry.action.teamIds] });
      }
      if (assignment?.allegiance === "good" && hasAnyInSet(entry.action.teamIds, publicEvil)) {
        audit.goodProposePublicEvilTeams.push({ step: entry.step, playerId: entry.playerId, teamIds: [...entry.action.teamIds] });
      }
    }

    if (entry.action.type === "vote") {
      pendingVotes.push(entry);
    }

    if (hasSecretIntentLeak(entry.speech, entry.playerId) && entry.speechRepairReason !== "secret-intent-leak") {
      audit.unrepairedSecretLeaks.push({ step: entry.step, playerId: entry.playerId, speech: entry.speech });
    }
    if (hasPromptCodeLeak(entry.speech)) {
      audit.promptCodeLeaks.push({ step: entry.step, playerId: entry.playerId, speech: entry.speech });
    }
    if (hasPublicFactOverclaim(entry.speech, publicGood, publicEvil, activeProposal)) {
      audit.publicFactOverclaims.push({ step: entry.step, playerId: entry.playerId, speech: entry.speech });
    }

    if (entry.actionKind === "quest") {
      pendingQuest.push(entry);
    }
  }

  finalizePendingVotes();

  if (pendingQuest.length) {
    questResults = applyQuestFacts(pendingQuest, playerIds, evilIds.size, publicEvil, publicGood, questResults);
  }

  audit.publicFacts.publicEvil = [...publicEvil].sort(comparePlayerIds);
  audit.publicFacts.publicGood = [...publicGood].sort(comparePlayerIds);
  return audit;
}

function applyQuestFacts(
  questEntries: RealApiAuditTraceEntry[],
  playerIds: string[],
  evilCount: number,
  publicEvil: Set<string>,
  publicGood: Set<string>,
  questResults: QuestResult[]
): QuestResult[] {
  const teamIds = [...new Set(questEntries.map((entry) => entry.playerId))];
  const failCards = questEntries.filter((entry) => entry.action.type === "quest" && entry.action.card === "fail").length;
  const nextQuestResults = [...questResults, { teamIds, failCards, succeeded: failCards === 0 }];
  const facts = derivePublicFacts({ playerIds, evilCount, questResults: nextQuestResults });
  publicEvil.clear();
  publicGood.clear();
  for (const id of facts.publicEvil) {
    publicEvil.add(id);
  }
  for (const id of facts.publicGood) {
    publicGood.add(id);
  }
  return nextQuestResults;
}

function isAllInSet(ids: string[], set: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id));
}

function hasAnyInSet(ids: string[], set: Set<string>): boolean {
  return ids.some((id) => set.has(id));
}

function hasSecretIntentLeak(speech: string, playerId?: string): boolean {
  return /(?:保留|留下|制造|创造|方便|准备|保住).{0,8}(?:破坏|失败牌|坏票)/u.test(speech)
    || /(?:可破坏位|破坏空间|破坏机会|作恶能力|作恶空间|作恶机会|可操作位|出坏票|出失败牌|投失败|打失败|交失败)/u.test(speech)
    || /\b(?:sabotage path|sabotage window|sabotage-capable|room to sabotage|play fail|submit fail|keep \w+ sabotage|create \w+ sabotage)\b/iu.test(speech)
    || hasSelfSideLeak(speech, playerId);
}

function hasPromptCodeLeak(speech: string): boolean {
  return /\b(?:KE|MC|CFG|OBJ|LG|LA)\b/u.test(speech)
    || /\b(?:PF|SELF_FACT|PRIVATE_FACT|PUBLIC_FACT)\b/u.test(speech)
    || /\b(?:confirmed-private-evil|ambiguous-merlin-morgana)\b/iu.test(speech)
    || /\bEV (?:private|public|pt\/v|slot)\b/iu.test(speech);
}

function hasPublicFactOverclaim(speech: string, publicGood: Set<string>, publicEvil: Set<string>, activeProposal: string[]): boolean {
  const clauses = speech.split(/[，,。.!?；;]/u);
  for (const clause of clauses) {
    const ids = extractPlayerIds(clause);
    if (!ids.length) {
      continue;
    }
    const wholeTeamGoodClaimIsValid = activeProposal.length
      && hasWholeTeamPublicGoodClaim(clause)
      && activeProposal.every((id) => publicGood.has(id));
    if (!wholeTeamGoodClaimIsValid
      && (hasPublicGoodClaim(clause) || hasDefinitiveGoodClaim(clause) || hasScoreHistoryGoodClaim(clause))) {
      const claimedGoodIds = extractAlignmentClaimTargetIds(clause, "good");
      const idsToCheck = claimedGoodIds.length ? claimedGoodIds : ids;
      if (idsToCheck.some((id) => !publicGood.has(id))) {
        return true;
      }
    }
    if (!wholeTeamGoodClaimIsValid
      && hasNoEvilClaim(clause)
      && ids.some((id) => !publicGood.has(id))) {
      return true;
    }
    if (hasPublicEvilClaim(clause)) {
      const claimedEvilIds = extractAlignmentClaimTargetIds(clause, "evil");
      const idsToCheck = claimedEvilIds.length ? claimedEvilIds : ids;
      if (idsToCheck.some((id) => !publicEvil.has(id))) {
        return true;
      }
    }
  }
  if (activeProposal.length && hasWholeTeamPublicGoodClaim(speech) && activeProposal.some((id) => !publicGood.has(id))) {
    return true;
  }
  if (activeProposal.length && hasWholeTeamPublicEvilClaim(speech) && activeProposal.some((id) => !publicEvil.has(id))) {
    return true;
  }
  return false;
}

function hasWholeTeamPublicGoodClaim(speech: string): boolean {
  return /(?:公开|公示|公共事实|已知|可视为|公开结果|公开硬事实|硬事实).{0,28}(?:这(?:整)?队|这个\s*\d+\s*人队|整队|全队|这两人|两人).{0,18}(?:全是|都是|全员|均为|全都).{0,8}(?:好人|忠臣|公好|公善|good)/iu.test(speech);
}

function hasWholeTeamPublicEvilClaim(speech: string): boolean {
  return /(?:公开|公示|公共事实|已知|可视为|公开结果|公开硬事实).{0,24}(?:这(?:整)?队|整队|全队|这两人|两人).{0,16}(?:全是|都是|全员|均为|全都).{0,8}(?:公恶|恶|坏|evil)/iu.test(speech);
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

function hasPublicGoodClaim(clause: string): boolean {
  if (hasNegatedGoodClaim(clause) || hasZeroFailResultOnlyClaim(clause)) {
    return false;
  }
  return /(?:公开|公示|公共事实|硬信息|硬事实|已知|已验证|验证|零失败|0F|0\s*失败|可视为).{0,18}(?:好人|忠臣|公正|清白|干净|公好|公善|好位|公忠|good|clean)/iu.test(clause)
    || hasReliabilityCertClaim(clause);
}

function hasDefinitiveGoodClaim(clause: string): boolean {
  if (/(?:我觉得|我认为|个人认为|从我视角|我视角|我的视角|从我这边看|我这边看|在我看来|偏|像|可能|也许|大概|倾向|读作|看作|疑似|怀疑|比较|相对|较为|更像)/u.test(clause)) {
    return false;
  }
  if (hasNegatedGoodClaim(clause)) {
    return false;
  }
  return /(?:p\s*)?(?:10|[1-9])\s*号?.{0,12}(?:是(?!否)|为|算|属于|可视为).{0,12}(?:好人|忠臣|公正|清白|干净|公好|公善|好位|公忠|good|clean)/iu.test(clause);
}

function hasScoreHistoryGoodClaim(clause: string): boolean {
  return /(?:战绩|记录|历史|score|history).{0,12}(?:压成|推出|证明|洗白|坐实|变成).{0,8}(?:好位|好人|忠臣|公正|清白|干净|公好|公善|公忠|good|clean)/iu.test(clause);
}

function hasReliabilityCertClaim(clause: string): boolean {
  if (hasNegatedGoodClaim(clause)) {
    return false;
  }
  return /(?:公开|公示|公共事实|硬信息|硬事实|已知|已验证|验证|公认|坐实|定死).{0,18}(?:可靠|可信|稳定|稳位|信任位|reliable|trusted|stable)/iu.test(clause)
    || /(?:p\s*)?(?:10|[1-9])\s*号?.{0,12}(?:是(?!否)|为|算|属于|可视为|已知|公认).{0,12}(?:可靠|可信|稳定|稳位|信任位|reliable|trusted|stable)/iu.test(clause);
}

function hasNoEvilClaim(clause: string): boolean {
  if (hasNegatedGoodClaim(clause) || hasLackOfPublicEvilEvidenceClaim(clause)) {
    return false;
  }
  return /(?:公开|公示|公共事实|硬信息|硬事实|已知|已验证|验证|可视为).{0,18}(?:无坏|无恶|没有坏|没有恶|无邪恶|no evil|no bad|known-no-evil|known safe|known-safe)/iu.test(clause)
    || /(?:不含|不带|没有|无).{0,8}(?:已知|公开|硬)?.{0,4}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/iu.test(clause);
}

function hasPublicEvilClaim(clause: string): boolean {
  if (hasPartialEvilClaim(clause) || hasNegatedEvilClaim(clause) || hasLackOfPublicEvilEvidenceClaim(clause)) {
    return false;
  }
  return /(?:公开|公示|公共事实|硬信息|硬事实|已知|已验证|验证|可视为).{0,18}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/iu.test(clause)
    || /(?:p\s*)?(?:10|[1-9])\s*号?.{0,12}(?:是(?!否)|为|算|属于|可视为).{0,12}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/iu.test(clause);
}

function hasLackOfPublicEvilEvidenceClaim(clause: string): boolean {
  return /(?:没有|没|无|缺少|不足|不够).{0,10}(?:足够|明确|直接|充分)?.{0,10}(?:公开|硬|已知)?.{0,6}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil).{0,8}(?:证据|信息|依据|理由)/iu.test(clause)
    || /(?:公开|硬|已知)?.{0,6}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil).{0,8}(?:证据|信息|依据|理由).{0,10}(?:不足|不够|不充分|不明确|没有|没|缺少|无)/iu.test(clause);
}

function hasPartialEvilClaim(clause: string): boolean {
  return /(?:至少|最少).{0,4}(?:一|1|[2-9])\s*(?:名|个|张)?.{0,6}(?:恶|坏|邪恶|evil)/iu.test(clause)
    || /(?:恶|坏|邪恶|evil).{0,6}(?:至少|最少).{0,4}(?:一|1|[2-9])\s*(?:名|个|张)?/iu.test(clause)
    || /(?:是|为|出过|出了|出现|打出|交出|有)\s*(?:0|零|一|1|两|2|[3-9])\s*(?:名|个|张|次)?.{0,2}(?:恶|坏|邪恶|evil)/iu.test(clause)
    || /(?:0|零|一|1|两|2|[3-9])\s*(?:名|个|张|次)?.{0,2}(?:恶|坏|邪恶|evil).{0,18}(?:压在|落在|集中在|归在|锁在|锁到|限制在).{0,24}(?:中|里|内|范围)/iu.test(clause)
    || /(?:中|里|里面|之中|范围内).{0,6}(?:一|1|两|2|[3-9])\s*(?:名|个|张)?.{0,4}(?:恶|坏|邪恶|evil)/iu.test(clause)
    || /(?:中|里|里面|之中|范围内).{0,10}(?:正好|恰好|刚好|有且仅有|已能锁到|能锁到|能确定|有|存在|包含|应有|应该有).{0,6}(?:一|1|两|2|[3-9])\s*(?:名|个|张)?.{0,6}(?:恶|坏|邪恶|evil)/iu.test(clause)
    || /(?:中|里|里面|之中|范围内).{0,10}(?:恶|坏|邪恶|evil).{0,6}(?:正好|恰好|刚好|有且仅有|有|存在|包含|应有|应该有).{0,6}(?:一|1|两|2|[3-9])\s*(?:名|个|张)?/iu.test(clause);
}

function hasNegatedGoodClaim(clause: string): boolean {
  return /(?:不能|不可|无法|不应|不要|别|并非|不是|不算|不构成|不足以|不代表|不能代表|并不代表).{0,24}(?:好位|好人|忠臣|公正|清白|干净|公好|公善|公忠|洗白|认好|安全|定论|定死|good|clean|safe)/iu.test(clause)
    || /(?:未被|没有被|并没有被|尚未被|还没被|未能).{0,12}(?:证明|验证|证成|坐实|打成|推出|排|洗|洗白|认).{0,12}(?:好位|好人|忠臣|公正|清白|干净|公好|公善|公忠|安全|good|clean|safe)/iu.test(clause);
}

function hasZeroFailResultOnlyClaim(clause: string): boolean {
  return /(?:0F|0\s*失败|零失败|无失败).{0,12}(?:只|仅).{0,4}(?:说明|代表).{0,12}(?:结果|当时|当轮|任务).{0,8}(?:干净|成功|没出坏|无失败)/iu.test(clause)
    || /(?:只|仅).{0,4}(?:说明|代表).{0,12}(?:结果|当时|当轮|任务).{0,8}(?:干净|成功|没出坏|无失败).{0,12}(?:0F|0\s*失败|零失败|无失败)/iu.test(clause);
}

function hasNegatedEvilClaim(clause: string): boolean {
  return /(?:不能|不可|无法|不应|不要|别|并非|不是|不算|不构成|不足以).{0,24}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/iu.test(clause)
    || /(?:不含|不带|没有|无).{0,8}(?:已知|公开|硬)?.{0,4}(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/iu.test(clause);
}

type AlignmentClaimSide = "good" | "evil";

interface PlayerIdOccurrence {
  id: string;
  start: number;
  end: number;
}

function extractAlignmentClaimTargetIds(clause: string, side: AlignmentClaimSide): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const termPattern = side === "good"
    ? /(?:好人|忠臣|公正|清白|干净|公好|公善|好位|公忠|good|clean|safe)/giu
    : /(?:恶阵营|邪恶|坏人|公恶|恶|坏|evil)/giu;

  let match: RegExpExecArray | null;
  while ((match = termPattern.exec(clause)) !== null) {
    const prefix = clause.slice(0, match.index);
    const connector = findLastClaimConnector(prefix);
    const targetIds = connector
      ? extractNearestClaimSubjectIds(prefix.slice(0, connector.index))
      : extractNearestClaimSubjectIds(prefix);

    for (const id of targetIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return ids;
}

function findLastClaimConnector(prefix: string): { index: number } | undefined {
  const connectors = [...prefix.matchAll(/(?:是(?!否)|为|算|属于|可视为|已知|已验证|验证|证明|硬证|打成|坐实|定为|排成|推出)/giu)];
  for (let index = connectors.length - 1; index >= 0; index -= 1) {
    const connector = connectors[index];
    const tail = prefix.slice(connector.index + connector[0].length);
    if (/^(?:\s|公开|公共|公示|硬|信息|事实|结果|已|被|验证|的)*$/u.test(tail)) {
      return { index: connector.index };
    }
  }
  return undefined;
}

function extractNearestClaimSubjectIds(prefix: string): string[] {
  const occurrences = extractPlayerIdOccurrences(prefix);
  if (!occurrences.length) {
    return [];
  }

  const group: PlayerIdOccurrence[] = [occurrences[occurrences.length - 1]];
  if (!isAllowedClaimSubjectSuffix(prefix.slice(group[0].end))) {
    return [];
  }

  for (let index = occurrences.length - 2; index >= 0; index -= 1) {
    const previous = occurrences[index];
    const separator = prefix.slice(previous.end, group[0].start);
    if (!/^\s*(?:[+\/、,，]|和|与|及)\s*$/u.test(separator)) {
      break;
    }
    group.unshift(previous);
  }

  return group.map((occurrence) => occurrence.id);
}

function isAllowedClaimSubjectSuffix(suffix: string): boolean {
  const compact = suffix.replace(/\s+/gu, "");
  return !compact
    || /^(?:(?:都|全|均|也|已|被|直接|已经|目前|当前|现在|双|两|一|二|三|0F|1F|2F|[0-9]+F|的|里|中|内|范围|之中|之内|正好|恰好|刚好|同时))*$/u.test(compact);
}

function extractPlayerIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const occurrence of extractPlayerIdOccurrences(text)) {
    if (!seen.has(occurrence.id)) {
      seen.add(occurrence.id);
      ids.push(occurrence.id);
    }
  }
  return ids;
}

function extractPlayerIdOccurrences(text: string): PlayerIdOccurrence[] {
  const occurrences: PlayerIdOccurrence[] = [];
  const playerToken = /(p\s*)?(10|[1-9])\s*号?(?!\d)/giu;
  let match: RegExpExecArray | null;
  while ((match = playerToken.exec(text)) !== null) {
    const prefix = match[1];
    const previous = text[match.index - 1] ?? "";
    const next = text[match.index + match[0].length] ?? "";
    if (!prefix && /[A-Za-z0-9]/u.test(previous)) {
      continue;
    }
    if (!prefix && /[A-Za-z0-9次张轮人]/u.test(next)) {
      continue;
    }

    occurrences.push({
      id: `p${match[2]}`,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return occurrences;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function increment<K extends string>(counts: Partial<Record<K, number>>, key: K): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function addCount<K extends string>(counts: Partial<Record<K, number>>, key: K, amount: number): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

interface NumberAccumulator {
  count: number;
  min: number;
  max: number;
  total: number;
}

function createNumberAccumulator(): NumberAccumulator {
  return {
    count: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0
  };
}

function addNumber(accumulator: NumberAccumulator, value: number): void {
  accumulator.count += 1;
  accumulator.min = Math.min(accumulator.min, value);
  accumulator.max = Math.max(accumulator.max, value);
  accumulator.total += value;
}

function addNumberForKey<K extends string>(accumulators: Partial<Record<K, NumberAccumulator>>, key: K, value: number): void {
  const accumulator = accumulators[key] ?? createNumberAccumulator();
  addNumber(accumulator, value);
  accumulators[key] = accumulator;
}

function summarizeNumbers(accumulator: NumberAccumulator): RealApiNumberSummary {
  return {
    count: accumulator.count,
    min: accumulator.min,
    max: accumulator.max,
    total: accumulator.total,
    average: accumulator.total / accumulator.count
  };
}

function addUsage(totals: RealApiUsageTotals, usage: AiApiUsage): void {
  totals.promptTokens += usage.promptTokens ?? 0;
  totals.completionTokens += usage.completionTokens ?? 0;
  totals.totalTokens += usage.totalTokens ?? 0;
  totals.cachedPromptTokens += usage.cachedPromptTokens ?? 0;
  totals.reasoningTokens += usage.reasoningTokens ?? 0;
}

function comparePlayerIds(left: string, right: string): number {
  return playerIdNumber(left) - playerIdNumber(right);
}

function playerIdNumber(playerId: string): number {
  const match = /^p(\d+)$/u.exec(playerId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
