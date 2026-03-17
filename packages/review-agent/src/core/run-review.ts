import { generateText, Output, type LanguageModel } from "ai";

import type { ReviewRequest } from "../contracts/review-request";
import {
  buildReviewPrompt,
  DEFAULT_REVIEW_SYSTEM_PROMPT,
} from "../llm/prompts";
import { reviewResultSchema } from "../schema/review-result.schema";
import { runPrReviewWithRepositoryTools } from "../lib/agent/pr-review-agent";
import { OutputValidationError } from "../errors/review-errors";

import { normalizeReviewRequest } from "./normalize-input";
import { validateReviewResult } from "./validate-output";
import { ReviewResult } from "../contracts/review-result";

export interface RunReviewOptions {
  model: LanguageModel;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  useRepositoryTools?: boolean;
  repositoryRoot?: string;
  maxToolSteps?: number;
  readFileMaxBytes?: number;
  searchMaxResults?: number;
  listMaxDepth?: number;
  listMaxEntries?: number;
}

export interface ReviewAgent {
  reviewPullRequest(input: ReviewRequest): Promise<ReviewResult>;
}

export type CreateReviewAgentOptions = RunReviewOptions;

function getErrorString(
  error: unknown,
  key: "name" | "message" | "code",
): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const value = Reflect.get(error, key);

  return typeof value === "string" ? value : "";
}

function hasCauseNamed(error: unknown, expectedName: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }

    const currentName = Reflect.get(current, "name");
    if (currentName === expectedName) {
      return true;
    }

    current = Reflect.get(current, "cause");
  }

  return false;
}

function hasCauseMessage(error: unknown, expectedText: string): boolean {
  const expected = expectedText.toLowerCase();
  let current: unknown = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object") {
      return false;
    }

    const message = getErrorString(current, "message").toLowerCase();
    if (message.includes(expected)) {
      return true;
    }

    current = Reflect.get(current, "cause");
  }

  return false;
}

function isToolOutputValidationFailure(error: unknown): boolean {
  if (error instanceof OutputValidationError) {
    return true;
  }

  const name = getErrorString(error, "name");
  const code = getErrorString(error, "code");
  const message = getErrorString(error, "message").toLowerCase();

  return (
    name === "AI_NoObjectGeneratedError" ||
    name === "AI_TypeValidationError" ||
    code === "AI_NO_OBJECT_GENERATED" ||
    code === "AI_TYPE_VALIDATION_ERROR" ||
    hasCauseNamed(error, "AI_NoObjectGeneratedError") ||
    hasCauseNamed(error, "AI_TypeValidationError") ||
    hasCauseNamed(error, "ZodError") ||
    message.includes("no object generated") ||
    message.includes("response did not match schema") ||
    message.includes(
      "model output does not match the expected review result schema",
    ) ||
    message.includes("invalid input: expected") ||
    hasCauseMessage(error, "response did not match schema") ||
    hasCauseMessage(error, "type validation failed")
  );
}

export async function runReview(
  input: ReviewRequest,
  options: RunReviewOptions,
): Promise<ReviewResult> {
  const useRepositoryTools = options.useRepositoryTools ?? true;
  if (useRepositoryTools) {
    try {
      return runPrReviewWithRepositoryTools(input, options);
    } catch (error) {
      if (!isToolOutputValidationFailure(error)) {
        throw error;
      }

      console.warn(
        "[review-agent] Tool-assisted review output validation failed, retrying without repository tools.",
        {
          errorName: getErrorString(error, "name") || "UnknownError",
          errorCode: getErrorString(error, "code") || undefined,
          errorMessage: getErrorString(error, "message") || "Unknown error",
        },
      );

      return runReview(input, {
        ...options,
        useRepositoryTools: false,
      });
    }
  }

  const normalizedRequest = normalizeReviewRequest(input);
  const startedAt = Date.now();

  const { output } = await generateText({
    model: options.model,
    system: options.systemPrompt ?? DEFAULT_REVIEW_SYSTEM_PROMPT,
    prompt: buildReviewPrompt(normalizedRequest),
    output: Output.object({
      schema: reviewResultSchema,
      name: "review_result",
      description: "Structured pull request review findings.",
    }),
    temperature: options.temperature ?? 0.1,
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: options.signal,
  });

  const result = validateReviewResult(output, normalizedRequest);
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
