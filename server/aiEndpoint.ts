import type { IncomingMessage, ServerResponse } from "node:http";
import { chooseFallbackDecision } from "../src/ai/fallback";
import { buildAIPrompt, createPersona, parseAiDecision } from "../src/ai/prompt";
import type { AiActionKind, AiDecisionResult, LegalAction, PublicTalkEntry, ReasoningEffort, TableLanguage } from "../src/ai/types";
import type { GameState } from "../src/game/types";
import { hasUsableOpenAIConfig, readOpenAIConfigFromEnv, type OpenAICompatibleConfig } from "./env";
import { callOpenAICompatible, OpenAICompatibleError } from "./openaiCompatible";

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
}

export async function createAiActionResult(input: CreateAiActionInput): Promise<AiDecisionResult> {
  const language = input.body.language ?? "en";
  const fallback = chooseFallbackDecision(input.body.state, input.body.playerId, input.body.actionKind, language);
  const legalActions = input.body.legalActions.length ? input.body.legalActions : [fallback.action];
  const config = input.config ?? readOpenAIConfigFromEnv();
  const effectiveConfig = {
    ...config,
    model: input.body.model?.trim() || config.model
  };

  if (!hasUsableOpenAIConfig(effectiveConfig)) {
    return { ...fallback, source: "fallback", fallbackReason: "missing-config" };
  }

  try {
    const prompt = buildAIPrompt({
      state: input.body.state,
      playerId: input.body.playerId,
      actionKind: input.body.actionKind,
      legalActions,
      tableTalk: input.body.tableTalk ?? [],
      persona: createPersona(input.body.playerId, input.body.state.playerCount),
      reasoningEffort: input.body.reasoningEffort,
      language
    });

    const content = await callOpenAICompatible({
      config: effectiveConfig,
      messages: prompt.messages,
      reasoningEffort: input.body.reasoningEffort,
      fetchImpl: input.fetchImpl
    });

    return parseAiDecision(content, legalActions, fallback);
  } catch (error) {
    return {
      ...fallback,
      source: "fallback",
      fallbackReason: error instanceof OpenAICompatibleError ? error.fallbackReason : "api-error"
    };
  }
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
