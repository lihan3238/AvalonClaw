import { callOpenAICompatible, joinOpenAIPath } from "./openaiCompatible";
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
