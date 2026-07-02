export interface OpenAICompatibleConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function readOpenAIConfigFromEnv(env: Record<string, string | undefined> = process.env): OpenAICompatibleConfig {
  const normalized = normalizeEnv(env);
  const baseURL = stripTrailingSlash(normalized.OPENAI_BASE_URL ?? normalized.base_url ?? normalized.BASE_URL ?? "https://api.openai.com/v1");
  const apiKey = normalized.OPENAI_API_KEY ?? normalized.API_KEY ?? "";
  const model = normalized.OPENAI_MODEL ?? normalized.MODEL ?? "gpt-5.4-mini";
  const timeoutMs = Number.parseInt(normalized.OPENAI_TIMEOUT_MS ?? "240000", 10);

  return {
    baseURL,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 240000
  };
}

export function hasUsableOpenAIConfig(config: OpenAICompatibleConfig): boolean {
  return Boolean(config.baseURL && config.apiKey && config.model);
}

function normalizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (key && value) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
