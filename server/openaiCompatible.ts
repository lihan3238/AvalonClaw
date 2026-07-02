import type { AiApiTiming, AiApiUsage, AiFallbackReason, ReasoningEffort, ChatMessage } from "../src/ai/types";
import type { OpenAICompatibleConfig } from "./env";

interface CallOpenAIInput {
  config: OpenAICompatibleConfig;
  messages: ChatMessage[];
  reasoningEffort: ReasoningEffort;
  fetchImpl?: typeof fetch;
}

type ApiProtocol = "responses" | "chat";

interface ProviderResponseBody {
  // Chat Completions shape
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  // Responses API shape
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
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
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

const TRANSIENT_HTTP_ATTEMPTS = 3;

// Remembered per base URL so a provider without /responses only pays the probe once per process.
const protocolPreferenceByBaseURL = new Map<string, ApiProtocol>();

export function resetOpenAIProtocolPreferences(): void {
  protocolPreferenceByBaseURL.clear();
}

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
  const postWithBudget = async (protocol: ApiProtocol, payload: Record<string, unknown>) => {
    const remainingAttempts = TRANSIENT_HTTP_ATTEMPTS - attempts;
    if (remainingAttempts <= 0) {
      throw new OpenAICompatibleError("OpenAI-compatible retry budget exhausted", "api-http-error");
    }
    try {
      const result = await postModelRequestWithRetries(input.config, protocol, payload, fetchImpl, remainingAttempts);
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
    let protocol: ApiProtocol = protocolPreferenceByBaseURL.get(input.config.baseURL) ?? "responses";
    let payload = buildModelRequestPayload(protocol, input.config.model, input.messages, input.reasoningEffort);
    let latest = await postWithBudget(protocol, payload);

    if (!latest.ok && protocol === "responses" && isProtocolUnsupported(latest.status, latest.text)) {
      protocol = "chat";
      payload = buildModelRequestPayload(protocol, input.config.model, input.messages, input.reasoningEffort);
      latest = await postWithBudget(protocol, payload);
    }

    if (!latest.ok && shouldRetryWithoutReasoning(latest.status, latest.text)) {
      payload = buildModelRequestPayload(protocol, input.config.model, input.messages);
      latest = await postWithBudget(protocol, payload);
    }

    if (!latest.ok) {
      throw withOpenAITiming(
        new OpenAICompatibleError(`OpenAI-compatible request failed (${latest.status}): ${latest.text}`, "api-http-error"),
        startedAt,
        attempts
      );
    }

    protocolPreferenceByBaseURL.set(input.config.baseURL, protocol);
    return withResultTiming(parseModelResponseResult(latest.text), startedAt, attempts);
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

export function buildResponsesPayload(model: string, messages: ChatMessage[], reasoningEffort?: ReasoningEffort): Record<string, unknown> {
  return {
    model,
    input: messages.map((message) => ({ role: message.role, content: message.content })),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    text: { format: { type: "json_object" } },
    store: false
  };
}

function buildModelRequestPayload(protocol: ApiProtocol, model: string, messages: ChatMessage[], reasoningEffort?: ReasoningEffort): Record<string, unknown> {
  return protocol === "responses"
    ? buildResponsesPayload(model, messages, reasoningEffort)
    : buildChatCompletionPayload(model, messages, reasoningEffort);
}

function protocolPath(protocol: ApiProtocol): string {
  return protocol === "responses" ? "/responses" : "/chat/completions";
}

async function postModelRequestWithRetries(
  config: OpenAICompatibleConfig,
  protocol: ApiProtocol,
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
      latest = await postModelRequest(config, protocol, payload, fetchImpl);
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
  latest = latest ?? await postModelRequest(config, protocol, payload, fetchImpl);
  return { ...latest, attempts: Math.max(attempts, 1) };
}

async function postModelRequest(
  config: OpenAICompatibleConfig,
  protocol: ApiProtocol,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(joinOpenAIPath(config.baseURL, protocolPath(protocol)), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      text = await response.text();
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
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function isProtocolUnsupported(status: number, body: string): boolean {
  if (status === 404 || status === 405) {
    return true;
  }
  return status >= 400 && status < 500 && /unknown request url|invalid url|no such route|not found|unknown endpoint|does not exist/i.test(body);
}

function shouldRetryWithoutReasoning(status: number, body: string): boolean {
  return status >= 400 && status < 500 && /reasoning|temperature|unrecognized|unknown parameter|unsupported/i.test(body);
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isTransientTransportError(error: OpenAICompatibleError): boolean {
  // A timed-out attempt means the provider needs longer than the full window
  // for this generation; an identical retry just multiplies the user's wait.
  return error.fallbackReason === "api-error";
}

function transientHttpRetryDelayMs(attempt: number): number {
  return Math.min(100 * 2 ** (attempt - 1), 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseModelResponseResult(body: string): OpenAICompatibleResult {
  let parsed: ProviderResponseBody;
  try {
    parsed = JSON.parse(body) as ProviderResponseBody;
  } catch {
    throw new OpenAICompatibleError("OpenAI-compatible response was not valid JSON", "api-invalid-response");
  }
  const content = parsed.choices?.[0]?.message?.content || extractResponsesOutputText(parsed);
  if (!content) {
    throw new OpenAICompatibleError("OpenAI-compatible response did not include message content or output_text", "api-empty-response");
  }

  const usage = normalizeUsage(parsed.usage);
  return {
    content,
    ...(usage ? { usage } : {}),
    timing: { durationMs: 0, attempts: 0 }
  };
}

function extractResponsesOutputText(parsed: ProviderResponseBody): string {
  if (typeof parsed.output_text === "string" && parsed.output_text) {
    return parsed.output_text;
  }
  if (!Array.isArray(parsed.output)) {
    return "";
  }
  return parsed.output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
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

function normalizeUsage(usage: ProviderResponseBody["usage"]): AiApiUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = numberOrUndefined(usage.prompt_tokens) ?? numberOrUndefined(usage.input_tokens);
  const completionTokens = numberOrUndefined(usage.completion_tokens) ?? numberOrUndefined(usage.output_tokens);
  const totalTokens = numberOrUndefined(usage.total_tokens)
    ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  const cachedPromptTokens = numberOrUndefined(usage.prompt_tokens_details?.cached_tokens)
    ?? numberOrUndefined(usage.input_tokens_details?.cached_tokens);
  const reasoningTokens = numberOrUndefined(usage.completion_tokens_details?.reasoning_tokens)
    ?? numberOrUndefined(usage.output_tokens_details?.reasoning_tokens);
  const normalized: AiApiUsage = {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
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
