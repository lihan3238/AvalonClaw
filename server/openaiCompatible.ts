import type { AiApiTiming, AiApiUsage, AiFallbackReason, ReasoningEffort, ChatMessage } from "../src/ai/types";
import type { OpenAICompatibleConfig } from "./env";

interface CallOpenAIInput {
  config: OpenAICompatibleConfig;
  messages: ChatMessage[];
  reasoningEffort: ReasoningEffort;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

const TRANSIENT_HTTP_ATTEMPTS = 3;

export interface OpenAICompatibleResult {
  content: string;
  usage?: AiApiUsage;
  timing: AiApiTiming;
}

export class OpenAICompatibleError extends Error {
  fallbackReason: AiFallbackReason;
  attempts?: number;
  durationMs?: number;

  constructor(message: string, fallbackReason: AiFallbackReason) {
    super(message);
    this.name = "OpenAICompatibleError";
    this.fallbackReason = fallbackReason;
  }
}

export function joinOpenAIPath(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

export async function callOpenAICompatible(input: CallOpenAIInput): Promise<string> {
  return (await callOpenAICompatibleWithUsage(input)).content;
}

export async function callOpenAICompatibleWithUsage(input: CallOpenAIInput): Promise<OpenAICompatibleResult> {
  const startedAt = Date.now();
  let attempts = 0;
  const fetchImpl = input.fetchImpl ?? fetch;
  const postWithBudget = async (payload: Record<string, unknown>) => {
    const remainingAttempts = TRANSIENT_HTTP_ATTEMPTS - attempts;
    if (remainingAttempts <= 0) {
      throw new OpenAICompatibleError("OpenAI-compatible retry budget exhausted", "api-http-error");
    }
    try {
      const result = await postChatCompletionWithRetries(input.config, payload, fetchImpl, remainingAttempts);
      attempts += result.attempts;
      return result;
    } catch (error) {
      if (error instanceof OpenAICompatibleError) {
        attempts += error.attempts ?? 0;
      }
      throw error;
    }
  };

  try {
    const firstPayload = buildChatCompletionPayload(input.config.model, input.messages, input.reasoningEffort);
    const first = await postWithBudget(firstPayload);

    if (!first.ok && shouldRetryWithoutReasoning(first.status, first.text)) {
      const retryPayload = buildChatCompletionPayload(input.config.model, input.messages);
      const retry = await postWithBudget(retryPayload);
      if (!retry.ok) {
        throw withOpenAITiming(
          new OpenAICompatibleError(`OpenAI-compatible request failed (${retry.status}): ${retry.text}`, "api-http-error"),
          startedAt,
          attempts
        );
      }

      return withResultTiming(parseChatCompletionResult(retry.text), startedAt, attempts);
    }

    if (!first.ok) {
      throw withOpenAITiming(
        new OpenAICompatibleError(`OpenAI-compatible request failed (${first.status}): ${first.text}`, "api-http-error"),
        startedAt,
        attempts
      );
    }

    return withResultTiming(parseChatCompletionResult(first.text), startedAt, attempts);
  } catch (error) {
    if (error instanceof OpenAICompatibleError) {
      throw withOpenAITiming(error, startedAt, error.attempts ?? attempts);
    }
    throw error;
  }
}

export function buildChatCompletionPayload(model: string, messages: ChatMessage[], reasoningEffort?: ReasoningEffort): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: 0.7,
    response_format: { type: "json_object" },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
  };
}

async function postChatCompletionWithRetries(
  config: OpenAICompatibleConfig,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  maxAttempts = TRANSIENT_HTTP_ATTEMPTS
): Promise<{ ok: boolean; status: number; text: string; attempts: number }> {
  let latest: { ok: boolean; status: number; text: string } | null = null;
  let latestError: OpenAICompatibleError | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      latest = await postChatCompletion(config, payload, fetchImpl);
    } catch (error) {
      if (error instanceof OpenAICompatibleError && isTransientTransportError(error) && attempt < maxAttempts) {
        latestError = error;
        await sleep(transientHttpRetryDelayMs(attempt));
        continue;
      }
      if (error instanceof OpenAICompatibleError) {
        error.attempts = attempts;
      }
      throw error;
    }
    if (latest.ok || !isTransientHttpStatus(latest.status) || attempt === maxAttempts) {
      return { ...latest, attempts };
    }
    await sleep(transientHttpRetryDelayMs(attempt));
  }
  if (latestError) {
    latestError.attempts = attempts;
    throw latestError;
  }
  latest = latest ?? await postChatCompletion(config, payload, fetchImpl);
  return { ...latest, attempts: Math.max(attempts, 1) };
}

async function postChatCompletion(
  config: OpenAICompatibleConfig,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(joinOpenAIPath(config.baseURL, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof OpenAICompatibleError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new OpenAICompatibleError("OpenAI-compatible request timed out", "api-timeout");
      }
      throw new OpenAICompatibleError(error instanceof Error ? error.message : "OpenAI-compatible request failed", "api-error");
    }

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryWithoutReasoning(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /reasoning[_\s-]*effort|unrecognized|unknown parameter|unsupported/i.test(body);
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isTransientTransportError(error: OpenAICompatibleError): boolean {
  return error.fallbackReason === "api-timeout" || error.fallbackReason === "api-error";
}

function transientHttpRetryDelayMs(attempt: number): number {
  return Math.min(100 * 2 ** (attempt - 1), 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseChatCompletionContent(body: string): string {
  return parseChatCompletionResult(body).content;
}

function parseChatCompletionResult(body: string): OpenAICompatibleResult {
  let parsed: ChatCompletionResponse;
  try {
    parsed = JSON.parse(body) as ChatCompletionResponse;
  } catch {
    throw new OpenAICompatibleError("OpenAI-compatible response was not valid JSON", "api-invalid-response");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new OpenAICompatibleError("OpenAI-compatible response did not include choices[0].message.content", "api-empty-response");
  }

  const usage = normalizeUsage(parsed.usage);
  return {
    content,
    ...(usage ? { usage } : {}),
    timing: { durationMs: 0, attempts: 0 }
  };
}

function withResultTiming(result: OpenAICompatibleResult, startedAt: number, attempts: number): OpenAICompatibleResult {
  return {
    ...result,
    timing: {
      durationMs: elapsedMs(startedAt),
      attempts
    }
  };
}

function withOpenAITiming(error: OpenAICompatibleError, startedAt: number, attempts: number): OpenAICompatibleError {
  error.durationMs = error.durationMs ?? elapsedMs(startedAt);
  error.attempts = error.attempts ?? attempts;
  return error;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function normalizeUsage(usage: ChatCompletionResponse["usage"]): AiApiUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const normalized: AiApiUsage = {
    ...(numberOrUndefined(usage.prompt_tokens) !== undefined ? { promptTokens: usage.prompt_tokens } : {}),
    ...(numberOrUndefined(usage.completion_tokens) !== undefined ? { completionTokens: usage.completion_tokens } : {}),
    ...(numberOrUndefined(usage.total_tokens) !== undefined ? { totalTokens: usage.total_tokens } : {}),
    ...(numberOrUndefined(usage.prompt_tokens_details?.cached_tokens) !== undefined ? { cachedPromptTokens: usage.prompt_tokens_details?.cached_tokens } : {}),
    ...(numberOrUndefined(usage.completion_tokens_details?.reasoning_tokens) !== undefined ? { reasoningTokens: usage.completion_tokens_details?.reasoning_tokens } : {})
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}
