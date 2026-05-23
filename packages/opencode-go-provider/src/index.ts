import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODEL = "deepseek-v4-flash";

export interface CreateOpenCodeGoModelOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export function createOpenCodeGoProvider(options?: {
  apiKey?: string;
  baseURL?: string;
}) {
  const apiKey = options?.apiKey ?? process.env.OPENCODE_GO_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OpenCode Go API key is required. Set OPENCODE_GO_API_KEY env var or pass apiKey option.",
    );
  }

  return createOpenAICompatible({
    apiKey,
    baseURL:
      options?.baseURL ?? process.env.OPENCODE_GO_BASE_URL ?? DEFAULT_BASE_URL,
    name: "opencode-go",
  });
}

export function createOpenCodeGoModel(
  modelId?: string,
  options?: CreateOpenCodeGoModelOptions,
): LanguageModel {
  const provider = createOpenCodeGoProvider(options);

  const model =
    options?.model ?? modelId ?? process.env.OPENCODE_GO_MODEL ?? DEFAULT_MODEL;

  return provider.chatModel(model);
}
