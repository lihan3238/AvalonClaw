import { readOpenAIConfigFromEnv } from "./env";

describe("OpenAI-compatible env config", () => {
  it("normalizes lowercase base_url and trims whitespace", () => {
    const config = readOpenAIConfigFromEnv({
      "base_url ": " https://example.test/v1/ ",
      OPENAI_API_KEY: " key ",
      OPENAI_MODEL: " model-a "
    });

    expect(config).toMatchObject({
      baseURL: "https://example.test/v1",
      apiKey: "key",
      model: "model-a",
      timeoutMs: 240_000
    });
  });

  it("prefers OPENAI_BASE_URL over lowercase compatibility aliases", () => {
    const config = readOpenAIConfigFromEnv({
      OPENAI_BASE_URL: "https://primary.test/v1",
      base_url: "https://secondary.test/v1",
      OPENAI_API_KEY: "key"
    });

    expect(config.baseURL).toBe("https://primary.test/v1");
  });
});
