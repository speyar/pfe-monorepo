import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import type { LanguageModel } from "ai";

import { ProviderConfigError } from "../errors/review-errors";

export interface CreateOpenCodeGoReviewModelInput {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  model?: string;
}

export function createOpenCodeGoReviewModel(
  input: CreateOpenCodeGoReviewModelInput = {},
): LanguageModel {
  const apiKey =
    input.apiKey ??
    process.env.OPENCODEGO_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new ProviderConfigError(
      "Set OPENCODEGO_API_KEY or OPENAI_API_KEY, or pass apiKey.",
    );
  }

  return createOpenCodeGoModel(
    input.model ?? process.env.OPENCODEGO_MODEL ?? "kimi-k2.5",
    {
      apiKey,
      baseURL: input.baseURL ?? process.env.OPENCODEGO_BASE_URL,
      headers: input.headers,
    },
  );
}
