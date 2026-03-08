import { generateObject, type LanguageModel } from "ai";

import type { ReviewRequest } from "../contracts/review-request";
import {
  buildReviewPrompt,
  DEFAULT_REVIEW_SYSTEM_PROMPT,
} from "../llm/prompts";
import { reviewResultSchema } from "../schema/review-result.schema";

import { normalizeReviewRequest } from "./normalize-input";
import { validateReviewResult } from "./validate-output";
import { ReviewResult } from "../contracts/review-result";

export interface RunReviewOptions {
  model: LanguageModel;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ReviewAgent {
  reviewPullRequest(input: ReviewRequest): Promise<ReviewResult>;
}

export type CreateReviewAgentOptions = RunReviewOptions;

export async function runReview(
  input: ReviewRequest,
  options: RunReviewOptions,
): Promise<ReviewResult> {
  const normalizedRequest = normalizeReviewRequest(input);
  const startedAt = Date.now();

  const { object } = await generateObject({
    model: options.model,
    schema: reviewResultSchema,
    system: options.systemPrompt ?? DEFAULT_REVIEW_SYSTEM_PROMPT,
    prompt: buildReviewPrompt(normalizedRequest),
    temperature: options.temperature ?? 0.1,
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: options.signal,
  });

  const result = validateReviewResult(object, normalizedRequest);
  return {
    ...result,
    summary: {
      ...result.summary,
      elapsedMs: result.summary.elapsedMs ?? Date.now() - startedAt,
    },
  };
}

export function createReviewAgent(
  options: CreateReviewAgentOptions,
): ReviewAgent {
  return {
    reviewPullRequest: async (input) => runReview(input, options),
  };
}
