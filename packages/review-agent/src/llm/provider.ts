import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import type { LanguageModel } from "ai";

import { ProviderConfigError } from "../errors/review-errors";

export interface CreateGitHubReviewModelInput {
  apiKey?: string;
  githubToken?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  model?: string;
}

export function createGitHubReviewModel(
  input: CreateGitHubReviewModelInput = {},
): LanguageModel {
  const openCodeGoApiKey = input.apiKey ?? process.env.OPENCODE_GO_API_KEY;

  if (openCodeGoApiKey) {
    return createOpenCodeGoModel(input.model, { apiKey: openCodeGoApiKey });
  }

  const apiKey =
    input.apiKey ??
    input.githubToken ??
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new ProviderConfigError(
      "Set OPENCODE_GO_API_KEY, COPILOT_GITHUB_TOKEN, or OPENAI_API_KEY, or pass apiKey/githubToken.",
    );
  }

  const baseURL =
    input.baseURL ??
    process.env.COPILOT_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.githubcopilot.com";

  const provider = createOpenaiCompatible({
    apiKey,
    baseURL,
    name: "copilot",
    headers: input.headers,
  });

  return provider(input.model ?? "gpt-5.3-codex");
}

export function createOpenCodeGoReviewModel(
  model?: string,
  apiKey?: string,
): LanguageModel {
  return createOpenCodeGoModel(model, { apiKey });
}
