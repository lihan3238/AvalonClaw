import { callOpenAICompatible, callOpenAICompatibleWithUsage, joinOpenAIPath, resetOpenAIProtocolPreferences } from "./openaiCompatible";
import type { OpenAICompatibleConfig } from "./env";

describe("OpenAI-compatible transport", () => {
  const config: OpenAICompatibleConfig = {
    baseURL: "https://example.test/v1",
    apiKey: "secret",
    model: "model-a",
    timeoutMs: 1000
  };

  beforeEach(() => {
    resetOpenAIProtocolPreferences();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins base URL and endpoint paths safely", () => {
    expect(joinOpenAIPath("https://example.test/v1/", "/chat/completions")).toBe("https://example.test/v1/chat/completions");
    expect(joinOpenAIPath("https://example.test/v1/", "/responses")).toBe("https://example.test/v1/responses");
  });

  it("prefers the Responses API with reasoning.effort and text.format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output_text: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}",
        usage: { input_tokens: 321, output_tokens: 25, output_tokens_details: { reasoning_tokens: 7 }, input_tokens_details: { cached_tokens: 128 } }
      }), { status: 200 })
    );

    const result = await callOpenAICompatibleWithUsage({
      config,
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "Return JSON" }],
      reasoningEffort: "high",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v1/responses");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.input).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "Return JSON" }
    ]);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.text).toEqual({ format: { type: "json_object" } });
    expect(body.store).toBe(false);
    expect(body.messages).toBeUndefined();
    expect(result).toMatchObject({
      content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}",
      usage: { promptTokens: 321, completionTokens: 25, totalTokens: 346, cachedPromptTokens: 128, reasoningTokens: 7 },
      timing: { attempts: 1, durationMs: expect.any(Number) }
    });
  });

  it("reads Responses API output arrays when output_text is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output: [
          { type: "reasoning", content: [] },
          { type: "message", content: [{ type: "output_text", text: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" }] }
        ]
      }), { status: 200 })
    );

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).resolves.toContain("\"ok\"");
  });

  it("falls back to chat completions when the provider has no /responses route and remembers it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unknown request URL: POST /v1/responses" } }), { status: 404 }))
      .mockImplementation(() => Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" } }] }), { status: 200 })
      ));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "high",
      fetchImpl
    })).resolves.toContain("\"ok\"");

    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v1/responses");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://example.test/v1/chat/completions");
    const chatBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(chatBody.messages).toBeDefined();
    expect(chatBody.reasoning_effort).toBe("high");
    expect(chatBody.response_format).toEqual({ type: "json_object" });

    // Next call for the same base URL skips the /responses probe entirely.
    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "high",
      fetchImpl
    })).resolves.toContain("\"ok\"");
    expect(fetchImpl.mock.calls[2][0]).toBe("https://example.test/v1/chat/completions");
  });

  it("retries without reasoning when a compatible provider rejects the parameter", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning" } }), { status: 400 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "{\"speech\":\"ok\",\"action\":{\"type\":\"vote\",\"approve\":true}}" }), {
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
    expect(firstBody.reasoning).toEqual({ effort: "high" });
    expect(secondBody.reasoning).toBeUndefined();
  });

  it("counts protocol and reasoning compatibility fallbacks against the total retry budget", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unknown request URL" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{\"s\":\"late ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" } }] }), { status: 200 }));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "high",
      fetchImpl
    })).rejects.toMatchObject({ fallbackReason: "api-http-error", attempts: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v1/responses");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://example.test/v1/chat/completions");
    expect(fetchImpl.mock.calls[2][0]).toBe("https://example.test/v1/chat/completions");
  });

  it("returns provider token usage diagnostics from chat-completions payloads", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unknown request URL" } }), { status: 404 }))
      .mockResolvedValueOnce(
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

    const result = await callOpenAICompatibleWithUsage({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "medium",
      fetchImpl
    });

    expect(result).toMatchObject({
      content: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}",
      usage: {
        promptTokens: 321,
        completionTokens: 18,
        totalTokens: 339,
        cachedPromptTokens: 128,
        reasoningTokens: 7
      },
      timing: { attempts: 2, durationMs: expect.any(Number) }
    });
  });

  it("records duration for successful slow requests instead of only failed attempts", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(12_345);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output_text: "{\"s\":\"Approve.\",\"a\":{\"t\":\"v\",\"ok\":1}}"
      }), { status: 200 })
    );

    const result = await callOpenAICompatibleWithUsage({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "medium",
      fetchImpl
    });

    expect(result.timing).toEqual({ attempts: 1, durationMs: 2345 });
  });

  it("classifies HTTP failures for endpoint diagnostics", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 })
    ));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).rejects.toMatchObject({ fallbackReason: "api-http-error" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries transient HTTP failures before falling back", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" }), { status: 200 }));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).resolves.toContain("\"ok\"");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await expect(callOpenAICompatibleWithUsage({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" }), { status: 200 }))
    })).resolves.toMatchObject({ timing: { attempts: 2, durationMs: expect.any(Number) } });
  });

  it("falls back after the initial transient HTTP attempt plus two retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary upstream unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" }), { status: 200 }));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).rejects.toMatchObject({ fallbackReason: "api-http-error" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries transient transport timeouts before falling back", async () => {
    const timeoutError = new DOMException("This operation was aborted", "AbortError");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "{\"s\":\"ok\",\"a\":{\"t\":\"v\",\"ok\":1}}" }), { status: 200 }));

    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl
    })).resolves.toContain("\"ok\"");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies empty and invalid provider response payloads", async () => {
    await expect(callOpenAICompatible({
      config,
      messages: [{ role: "user", content: "Return JSON" }],
      reasoningEffort: "low",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "" }), { status: 200 }))
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
