import type { IncomingMessage, ServerResponse } from "node:http";
import { chooseFallbackDecision } from "../src/ai/fallback";
import { buildAIPrompt, createPersona, measurePromptMessages, parseAiDecision } from "../src/ai/prompt";
import type { AiActionKind, AiDecisionResult, AiPromptMetrics, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "../src/ai/types";
import type { GameState } from "../src/game/types";
import { hasUsableOpenAIConfig, readOpenAIConfigFromEnv, type OpenAICompatibleConfig } from "./env";
import { callOpenAICompatibleWithUsage, OpenAICompatibleError } from "./openaiCompatible";

export interface AiActionRequestBody {
  state: GameState;
  playerId: string;
  actionKind: AiActionKind;
  legalActions: LegalAction[];
  tableTalk?: PublicTalkEntry[];
  reasoningEffort: ReasoningEffort;
  language?: TableLanguage;
  model?: string;
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
  const legalActions = input.body.legalActions.length ? input.body.legalActions : [fallback.action];
  const localDecision = chooseLocalDecision(input.body.actionKind, legalActions, fallback);
  if (localDecision) {
    return localDecision;
  }

  const config = input.config ?? readOpenAIConfigFromEnv();
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

    const decision = parseAiDecision(modelResult.content, legalActions, fallback);
    return {
      ...decision,
      promptMetrics,
      ...(modelResult.usage ? { apiUsage: modelResult.usage } : {}),
      ...(input.includeRawModelContent ? { rawModelContent: modelResult.content } : {})
    };
  } catch (error) {
    return {
      ...fallback,
      source: "fallback",
      fallbackReason: error instanceof OpenAICompatibleError ? error.fallbackReason : "api-error",
      ...(promptMetrics ? { promptMetrics } : {})
    };
  }
}

export function effectiveReasoningEffortForAction(actionKind: AiActionKind, requested: ReasoningEffort): ReasoningEffort {
  if (actionKind === "quest") {
    return "low";
  }
  if (actionKind === "vote" && requested === "high") {
    return "medium";
  }
  if (actionKind === "assassinate" && requested === "high") {
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

export async function handleAiActionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = (await readJsonBody(req)) as AiActionRequestBody;
    const result = await createAiActionResult({ body });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid AI action request" });
  }
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
