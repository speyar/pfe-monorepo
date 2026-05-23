import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import type { LanguageModel } from "ai";

const DEFAULT_BASE_URL = "https://api.githubcopilot.com";
const DEFAULT_MODEL = "gpt-5.4-mini";

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
  const apiKey = options?.apiKey ?? process.env.COPILOT_GITHUB_TOKEN;

  if (!apiKey) {
    throw new Error(
      "Copilot API key is required. Set COPILOT_GITHUB_TOKEN env var or pass apiKey option.",
    );
  }

  return createOpenaiCompatible({
    apiKey,
    baseURL:
      options?.baseURL ?? process.env.COPILOT_BASE_URL ?? DEFAULT_BASE_URL,
    name: "copilot",
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
    options?.model ?? modelId ?? process.env.COPILOT_MODEL ?? DEFAULT_MODEL;

  return provider.chat(model) as unknown as LanguageModel;
}
