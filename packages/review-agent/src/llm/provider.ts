import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { ProviderConfigError } from "../errors/review-errors";

export interface CreateGeminiReviewModelInput {
  apiKey?: string;
  model?: string;
}

export function createGeminiReviewModel(
  input: CreateGeminiReviewModelInput = {},
): LanguageModel {
  const apiKey = input.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new ProviderConfigError(
      "GOOGLE_GENERATIVE_AI_API_KEY is required to create Gemini review model.",
    );
  }

  const provider = createGoogleGenerativeAI({
    apiKey,
  });

  return provider(input.model ?? "gemini-2.0-flash");
}
