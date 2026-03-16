import {
  generateText,
  Output,
  stepCountIs,
  tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import type { ReviewRequest } from "../../contracts/review-request";
import type { ReviewResult } from "../../contracts/review-result";
import {
  normalizeReviewRequest,
  type NormalizedReviewRequest,
} from "../../core/normalize-input";
import { validateReviewResult } from "../../core/validate-output";
import { reviewResultSchema } from "../../schema/review-result.schema";
import { listFiles } from "../repo-tools/list-files";
import { readFile } from "../repo-tools/read-file";
import { searchRepository } from "../repo-tools/search-repo";
import { RepoToolError } from "../repo-tools/shared";

const DEFAULT_MAX_TOOL_STEPS = 12;
const DEFAULT_READ_FILE_MAX_BYTES = 64_000;
const DEFAULT_SEARCH_MAX_RESULTS = 120;
const DEFAULT_LIST_MAX_DEPTH = 2;
const DEFAULT_LIST_MAX_ENTRIES = 400;

export const DEFAULT_REPOSITORY_EXPLORATION_SYSTEM_PROMPT = [
  "You are an expert PR review agent.",
  "You can inspect the repository using tools: readFile, searchRepository, listFiles.",
  "Use the tools to analyze how changed files impact other files before producing findings.",
  "Reasoning workflow:",
  "1) Inspect changed files and patch hunks from the prompt.",
  "2) Identify important symbols and behavioral changes.",
  "3) Search for references and usage patterns with searchRepository.",
  "4) Open impacted files with readFile and inspect relevant directories with listFiles.",
  "5) Report only high-confidence findings backed by inspected code.",
  "Return output that matches the schema exactly.",
  "Do not include markdown and do not include text outside the structured result.",
].join(" ");

export interface CreatePrReviewAgentOptions {
  model: LanguageModel;
  repositoryRoot?: string;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxToolSteps?: number;
  readFileMaxBytes?: number;
  searchMaxResults?: number;
  listMaxDepth?: number;
  listMaxEntries?: number;
  signal?: AbortSignal;
}

export interface PrReviewAgent {
  reviewPullRequest(input: ReviewRequest): Promise<ReviewResult>;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...<truncated>`;
}

function formatChangedFiles(input: NormalizedReviewRequest): string {
  return input.files
    .map((file) => {
      const patchOrContent = file.patch ?? file.content ?? "";
      const body = truncate(patchOrContent, input.config.maxPatchCharsPerFile);

      return [
        `### ${file.path}`,
        `status: ${file.status ?? "modified"}`,
        file.language ? `language: ${file.language}` : "",
        body,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildRepositoryExplorationPrompt(
  input: NormalizedReviewRequest,
): string {
  const changedFilePaths = input.files.map((file) => file.path).join(", ");

  return [
    `Repository: ${input.repository.owner}/${input.repository.name}`,
    `Pull request: #${input.pullRequest.number} ${input.pullRequest.title}`,
    `Base SHA: ${input.pullRequest.baseSha}`,
    `Head SHA: ${input.pullRequest.headSha}`,
    input.pullRequest.body ? `Description:\n${input.pullRequest.body}` : "",
    `Changed files (${input.files.length}): ${changedFilePaths}`,
    `Max findings: ${input.config.maxFindings}`,
    "",
    "Changed file patches/content:",
    formatChangedFiles(input),
    "",
    "Use repository tools to inspect impact outside changed files when needed.",
    "Review for correctness, security, performance, and maintainability.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeToolStepLimit(maxToolSteps?: number): number {
  if (maxToolSteps === undefined) {
    return DEFAULT_MAX_TOOL_STEPS;
  }

  if (
    !Number.isInteger(maxToolSteps) ||
    maxToolSteps < 1 ||
    maxToolSteps > 30
  ) {
    return DEFAULT_MAX_TOOL_STEPS;
  }

  return maxToolSteps;
}

function buildToolErrorResult(error: unknown): {
  ok: false;
  error: {
    code: string;
    message: string;
  };
} {
  if (error instanceof RepoToolError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: "TOOL_EXECUTION_ERROR",
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "TOOL_EXECUTION_ERROR",
      message: "Unknown tool execution error.",
    },
  };
}

function buildRepositoryTools(options: CreatePrReviewAgentOptions) {
  const repositoryRoot = options.repositoryRoot;

  return {
    readFile: tool({
      description:
        "Read a file from the repository to inspect implementation details.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Repository-relative path to the file to read."),
        maxBytes: z
          .number()
          .int()
          .min(256)
          .max(500_000)
          .optional()
          .describe("Optional max number of bytes to read from the file."),
      }),
      execute: async ({ path, maxBytes }) => {
        try {
          return await readFile(path, {
            repositoryRoot,
            maxBytes:
              maxBytes ??
              options.readFileMaxBytes ??
              DEFAULT_READ_FILE_MAX_BYTES,
          });
        } catch (error) {
          return buildToolErrorResult(error);
        }
      },
    }),

    searchRepository: tool({
      description:
        "Search the repository for symbol/function/component references.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Search query to look up in repository code."),
        isRegexp: z
          .boolean()
          .optional()
          .describe("Set true to interpret query as a regular expression."),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Set true for case-sensitive matching."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of matches to return."),
      }),
      execute: async ({ query, isRegexp, caseSensitive, maxResults }) => {
        try {
          return await searchRepository(query, {
            repositoryRoot,
            isRegexp,
            caseSensitive,
            maxResults:
              maxResults ??
              options.searchMaxResults ??
              DEFAULT_SEARCH_MAX_RESULTS,
          });
        } catch (error) {
          return buildToolErrorResult(error);
        }
      },
    }),

    listFiles: tool({
      description:
        "List files and directories inside a repository path for exploration.",
      inputSchema: z.object({
        path: z
          .string()
          .default(".")
          .describe("Directory path to list, relative to repository root."),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(8)
          .optional()
          .describe("Maximum recursion depth for directory traversal."),
        maxEntries: z
          .number()
          .int()
          .min(1)
          .max(2_000)
          .optional()
          .describe("Maximum number of directory entries to return."),
      }),
      execute: async ({ path, maxDepth, maxEntries }) => {
        try {
          return await listFiles(path, {
            repositoryRoot,
            maxDepth:
              maxDepth ?? options.listMaxDepth ?? DEFAULT_LIST_MAX_DEPTH,
            maxEntries:
              maxEntries ?? options.listMaxEntries ?? DEFAULT_LIST_MAX_ENTRIES,
          });
        } catch (error) {
          return buildToolErrorResult(error);
        }
      },
    }),
  };
}

export async function runPrReviewWithRepositoryTools(
  input: ReviewRequest,
  options: CreatePrReviewAgentOptions,
): Promise<ReviewResult> {
  const normalizedRequest = normalizeReviewRequest(input);
  const startedAt = Date.now();

  const { output } = await generateText({
    model: options.model,
    system:
      options.systemPrompt ?? DEFAULT_REPOSITORY_EXPLORATION_SYSTEM_PROMPT,
    prompt: buildRepositoryExplorationPrompt(normalizedRequest),
    tools: buildRepositoryTools(options),
    stopWhen: stepCountIs(normalizeToolStepLimit(options.maxToolSteps)),
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

export function createPrReviewAgent(
  options: CreatePrReviewAgentOptions,
): PrReviewAgent {
  return {
    reviewPullRequest: async (input) =>
      runPrReviewWithRepositoryTools(input, options),
  };
}
