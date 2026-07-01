import { callOpenAICompatible, callOpenAICompatibleWithUsage, joinOpenAIPath } from "./openaiCompatible";
import type { OpenAICompatibleConfig } from "./env";

describe("OpenAI-compatible transport", () => {
  const config: OpenAICompatibleConfig = {
    baseURL: "https://example.test/v1",
    apiKey: "secret",
    model: "model-a",
    timeoutMs: 1000
  };

  it("joins base URL and chat completions path safely", () => {
    expect(joinOpenAIPath("https://example.test/v1/", "/chat/completions")).toBe("https://example.test/v1/chat/completions");
  });

  it("retries without reasoning_effort when a compatible provider rejects it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"speech\":\"ok\",\"action\":{\"type\":\"vote\",\"approve\":true}}" } }] }), {
          status: 200
        })
      );

    const content = await callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "high",
      fetchImpl
    });

    expect(content).toContain("\"approve\":true");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(firstBody.reasoning_effort).toBe("high");
    expect(secondBody.reasoning_effort).toBeUndefined();
  });

  it("returns provider token usage diagnostics when present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}" } }],
        usage: {
          prompt_tokens: 321,
          completion_tokens: 18,
          total_tokens: 339,
          prompt_tokens_details: { cached_tokens: 128 },
          completion_tokens_details: { reasoning_tokens: 7 }
        }
      }), { status: 200 })
    );

    await expect(callOpenAICompatibleWithUsage({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "medium",
      fetchImpl
    })).resolves.toEqual({
      content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}",
      usage: {
        promptTokens: 321,
        completionTokens: 18,
        totalTokens: 339,
        cachedPromptTokens: 128,
        reasoningTokens: 7
      }
    });
  });

  it("classifies HTTP failures for endpoint diagnostics", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 }));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).rejects.toMatchObject({ fallbackReason: "api-http-error" });
  });

  it("classifies empty and invalid provider response payloads", async () => {
    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }))
    })).rejects.toMatchObject({ fallbackReason: "api-empty-response" });

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl: vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))
    })).rejects.toMatchObject({ fallbackReason: "api-invalid-response" });
  });

  it("classifies request aborts as timeouts", async () => {
    const timeoutError = new DOMException("This operation was aborted", "AbortError");
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError);

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).rejects.toMatchObject({ fallbackReason: "api-timeout", name: "OpenAICompatibleError" });
  });
});
