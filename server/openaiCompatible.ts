import type { ReasoningEffort, ChatMessage } from "../src/ai/types";
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
}

export function joinOpenAIPath(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

export async function callOpenAICompatible(input: CallOpenAIInput): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const firstPayload = buildChatCompletionPayload(input.config.model, input.messages, input.reasoningEffort);
  const first = await postChatCompletion(input.config, firstPayload, fetchImpl);

  if (!first.ok && shouldRetryWithoutReasoning(first.status, first.text)) {
    const retryPayload = buildChatCompletionPayload(input.config.model, input.messages);
    const retry = await postChatCompletion(input.config, retryPayload, fetchImpl);
    if (!retry.ok) {
      throw new Error(`OpenAI-compatible request failed (${retry.status}): ${retry.text}`);
    }

    return parseChatCompletionContent(retry.text);
  }

  if (!first.ok) {
    throw new Error(`OpenAI-compatible request failed (${first.status}): ${first.text}`);
  }

  return parseChatCompletionContent(first.text);
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

async function postChatCompletion(
  config: OpenAICompatibleConfig,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(joinOpenAIPath(config.baseURL, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

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

function parseChatCompletionContent(body: string): string {
  const parsed = JSON.parse(body) as ChatCompletionResponse;
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI-compatible response did not include choices[0].message.content");
  }

  return content;
}
