import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import type { LanguageModel } from "ai";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODEL = "kimi-k2.6";

export interface CreateOpenCodeGoProviderOptions {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface CreateOpenCodeGoModelOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  headers?: Record<string, string>;
}

function createOpenCodeGoProvider(options?: CreateOpenCodeGoProviderOptions) {
  const apiKey = options?.apiKey ?? process.env.OPENCODEGO_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OpenCode Go API key is required. Set OPENCODEGO_API_KEY env var or pass apiKey option.",
    );
  }

  return createOpenaiCompatible({
    apiKey,
    baseURL:
      options?.baseURL ?? process.env.OPENCODEGO_BASE_URL ?? DEFAULT_BASE_URL,
    name: "opencode-go",
    headers: options?.headers,
  });
}

export function createOpenCodeGoModel(
  modelId?: string,
  options?: CreateOpenCodeGoModelOptions,
): LanguageModel {
  const provider = createOpenCodeGoProvider({
    apiKey: options?.apiKey,
    baseURL: options?.baseURL,
    headers: options?.headers,
  });

  const model =
    options?.model ?? modelId ?? process.env.OPENCODEGO_MODEL ?? DEFAULT_MODEL;

  return provider.chat(model) as unknown as LanguageModel;
}

const COPILOT_DEFAULT_BASE_URL = "https://api.githubcopilot.com";
const COPILOT_DEFAULT_MODEL = "gpt-5-mini";

function createCopilotProvider(options?: { apiKey?: string; baseURL?: string; headers?: Record<string, string> }) {
  const apiKey =
    options?.apiKey ??
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN;

  if (!apiKey) {
    throw new Error(
      "GitHub Copilot token is required. Set COPILOT_GITHUB_TOKEN or GITHUB_TOKEN env var.",
    );
  }

  return createOpenaiCompatible({
    apiKey,
    baseURL: options?.baseURL ?? process.env.COPILOT_BASE_URL ?? COPILOT_DEFAULT_BASE_URL,
    name: "github-copilot",
    headers: options?.headers,
  });
}

export function createCopilotModel(
  modelId?: string,
  options?: { apiKey?: string; baseURL?: string; model?: string; headers?: Record<string, string> },
): LanguageModel {
  const provider = createCopilotProvider({
    apiKey: options?.apiKey,
    baseURL: options?.baseURL,
    headers: options?.headers,
  });

  const model =
    options?.model ?? modelId ?? process.env.COPILOT_MODEL ?? COPILOT_DEFAULT_MODEL;

  return provider.chat(model) as unknown as LanguageModel;
}

export function createReviewModel(
  modelId?: string,
  options?: { apiKey?: string; baseURL?: string; model?: string; headers?: Record<string, string> },
): LanguageModel {
  const provider = process.env.REVIEW_PROVIDER ?? "copilot";

  if (provider === "opencode") {
    return createOpenCodeGoModel(modelId, options);
  }

  return createCopilotModel(undefined, options);
}
