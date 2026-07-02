import type { IncomingMessage, ServerResponse } from "node:http";
import { chooseFallbackDecision } from "../src/ai/fallback";
import { buildAIPrompt, createPersona, measurePromptMessages, parseAiDecision } from "../src/ai/prompt";
import type { AiActionKind, AiApiTiming, AiDecisionResult, AiPromptMetrics, AiRuntimeConfig, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "../src/ai/types";
import { getLegalActionsForPlayer } from "../src/game/legalActions";
import type { GameState } from "../src/game/types";
import { hasUsableOpenAIConfig, type OpenAICompatibleConfig } from "./env";
import { callOpenAICompatibleWithUsage, OpenAICompatibleError } from "./openaiCompatible";

export interface AiActionRequestBody {
  sessionId?: string;
  state: GameState;
  playerId: string;
  actionKind: AiActionKind;
  legalActions: LegalAction[];
  tableTalk?: PublicTalkEntry[];
  reasoningEffort: ReasoningEffort;
  language?: TableLanguage;
  model?: string;
  aiConfig?: AiRuntimeConfig;
}

interface CreateAiActionInput {
  body: AiActionRequestBody;
  config?: OpenAICompatibleConfig;
  fetchImpl?: typeof fetch;
  includeRawModelContent?: boolean;
}

export async function createAiActionResult(input: CreateAiActionInput): Promise<AiDecisionResult> {
  const language = input.body.language ?? "en";
  const fallback = chooseFallbackDecision(input.body.state, input.body.playerId, input.body.actionKind, language);
  let legalActions: LegalAction[];
  try {
    legalActions = getLegalActionsForPlayer(input.body.state, input.body.playerId, input.body.actionKind);
  } catch {
    return {
      ...fallback,
      source: "fallback",
      fallbackReason: "illegal-action",
      fallbackDetail: "illegal-action"
    };
  }
  const localDecision = chooseLocalDecision(input.body.actionKind, legalActions, fallback);
  if (localDecision) {
    return localDecision;
  }

  const config = input.config ?? readOpenAIConfigFromBody(input.body);
  const effectiveConfig = {
    ...config,
    model: input.body.model?.trim() || config.model
  };

  if (!hasUsableOpenAIConfig(effectiveConfig)) {
    return { ...fallback, source: "fallback", fallbackReason: "missing-config" };
  }

  let promptMetrics: AiPromptMetrics | undefined;
  try {
    const reasoningEffort = effectiveReasoningEffortForAction(input.body.actionKind, input.body.reasoningEffort);
    const prompt = buildAIPrompt({
      state: input.body.state,
      playerId: input.body.playerId,
      actionKind: input.body.actionKind,
      legalActions,
      tableTalk: input.body.tableTalk ?? [],
      persona: createPersona(input.body.playerId, input.body.state.playerCount),
      reasoningEffort,
      language
    });
    promptMetrics = measurePromptMessages(prompt.messages);

    const modelResult = await callOpenAICompatibleWithUsage({
      config: effectiveConfig,
      messages: prompt.messages,
      reasoningEffort,
      fetchImpl: input.fetchImpl
    });

    const decision = parseAiDecision(modelResult.content, legalActions, fallback, { playerId: input.body.playerId });
    return {
      ...decision,
      promptMetrics,
      ...(modelResult.usage ? { apiUsage: modelResult.usage } : {}),
      apiTiming: modelResult.timing,
      ...(input.includeRawModelContent ? { rawModelContent: modelResult.content } : {})
    };
  } catch (error) {
    const fallbackDiagnostic = error instanceof OpenAICompatibleError ? compactDiagnostic(error.message) : undefined;
    const apiTiming = timingFromOpenAIError(error);
    return {
      ...fallback,
      source: "fallback",
      fallbackReason: error instanceof OpenAICompatibleError ? error.fallbackReason : "api-error",
      ...(fallbackDiagnostic ? { fallbackDiagnostic } : {}),
      ...(apiTiming ? { apiTiming } : {}),
      ...(promptMetrics ? { promptMetrics } : {})
    };
  }
}

export function effectiveReasoningEffortForAction(actionKind: AiActionKind, requested: ReasoningEffort): ReasoningEffort {
  if (actionKind === "quest") {
    return "low";
  }
  if ((actionKind === "speak" || actionKind === "vote") && (requested === "high" || requested === "xhigh")) {
    return "medium";
  }
  return requested;
}

function chooseLocalDecision(actionKind: AiActionKind, legalActions: LegalAction[], fallback: { speech: string; action: LegalAction }): AiDecisionResult | null {
  if (actionKind === "quest") {
    const fallbackQuestAction = fallback.action.type === "quest" ? fallback.action : undefined;
    const legalQuestAction = fallbackQuestAction
      ? legalActions.find((action) => action.type === "quest" && action.card === fallbackQuestAction.card)
      : legalActions.find((action) => action.type === "quest");
    if (!legalQuestAction) {
      return null;
    }
    return {
      speech: fallback.speech,
      action: legalQuestAction,
      source: "local"
    };
  }
  return null;
}

function compactDiagnostic(message: string): string {
  return message.replace(/\s+/gu, " ").trim().slice(0, 500);
}

function timingFromOpenAIError(error: unknown): AiApiTiming | undefined {
  if (!(error instanceof OpenAICompatibleError)) {
    return undefined;
  }
  if (error.durationMs === undefined && error.attempts === undefined) {
    return undefined;
  }
  return {
    durationMs: error.durationMs ?? 0,
    attempts: error.attempts ?? 0
  };
}

function readOpenAIConfigFromBody(body: AiActionRequestBody): OpenAICompatibleConfig {
  return {
    baseURL: normalizeBaseURL(body.aiConfig?.baseURL),
    apiKey: normalizeString(body.aiConfig?.apiKey),
    model: body.model?.trim() || "gpt-5.4-mini",
    timeoutMs: 45_000
  };
}

function normalizeBaseURL(value: unknown): string {
  const raw = normalizeString(value).replace(/\/+$/u, "");
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : "";
  } catch {
    return "";
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function handleAiActionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = (await readJsonBody(req)) as AiActionRequestBody;
    const startedAt = Date.now();
    const result = await createAiActionResult({ body });
    logAiAction(body, result, Date.now() - startedAt);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid AI action request" });
  }
}

function logAiAction(body: AiActionRequestBody, result: AiDecisionResult, requestDurationMs: number): void {
  console.info(JSON.stringify({
    event: "ai-action",
    sessionId: normalizeString(body.sessionId),
    phase: body.state?.phase,
    questIndex: body.state?.questIndex,
    playerId: body.playerId,
    actionKind: body.actionKind,
    source: result.source,
    fallbackReason: result.fallbackReason,
    speechRepairReason: result.speechRepairReason,
    requestDurationMs,
    apiDurationMs: result.apiTiming?.durationMs,
    apiAttempts: result.apiTiming?.attempts,
    promptChars: result.promptMetrics?.totalChars,
    totalTokens: result.apiUsage?.totalTokens,
    reasoningTokens: result.apiUsage?.reasoningTokens
  }));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
