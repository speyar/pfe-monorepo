import {
  SandboxManager,
  VercelSandboxProvider,
  type SandboxManagerLogger,
} from "@packages/sandbox";

import type { LanguageModel } from "ai";

import {
  normalizeReviewRequest,
  type NormalizedReviewRequest,
} from "../core/normalize-input";
import { runPrReviewWithRepositoryTools } from "../lib/agent/pr-review-agent";
import type { ReviewRequest } from "../contracts/review-request";
import type { ReviewResult } from "../contracts/review-result";

import { createRepositoryCloneAuth } from "./github-auth";
import { createSandboxRepositoryToolsRunner } from "./sandbox-runner";

const DEFAULT_SANDBOX_TIMEOUT_SECONDS = 900;
const DEFAULT_REVIEW_TIMEOUT_MS = 240_000;
const DEFAULT_SANDBOX_RUNTIME = "node24";

export interface SandboxReviewExecutorOptions {
  model: LanguageModel;
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  maxToolSteps?: number;
  readFileMaxBytes?: number;
  searchMaxResults?: number;
  listMaxDepth?: number;
  listMaxEntries?: number;
  reviewTimeoutMs?: number;
  sandboxTimeoutSeconds?: number;
  sandboxRuntime?: string;
  logger?: SandboxManagerLogger;
}

export class SandboxReviewExecutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SandboxReviewExecutionError";
  }
}

function isRepositoryPrivate(input: NormalizedReviewRequest): boolean | null {
  const metadata = input.metadata as Record<string, unknown> | undefined;
  const value = metadata?.repositoryPrivate;

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function getRepoUrl(input: NormalizedReviewRequest): string {
  return `https://github.com/${input.repository.owner}/${input.repository.name}.git`;
}

function getRevision(input: NormalizedReviewRequest): string {
  return input.pullRequest.headSha || input.pullRequest.headRef || "main";
}

function timeoutPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SandboxReviewExecutionError(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function runReviewInSandbox(
  input: ReviewRequest,
  options: SandboxReviewExecutorOptions,
): Promise<ReviewResult> {
  const normalized = normalizeReviewRequest(input);
  console.info("[review-agent] sandbox init", {
    repository: `${normalized.repository.owner}/${normalized.repository.name}`,
    pullRequestNumber: normalized.pullRequest.number,
    headSha: normalized.pullRequest.headSha,
    runtime: options.sandboxRuntime ?? DEFAULT_SANDBOX_RUNTIME,
    sandboxTimeoutSeconds:
      options.sandboxTimeoutSeconds ?? DEFAULT_SANDBOX_TIMEOUT_SECONDS,
    reviewTimeoutMs: options.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
  });

  const provider = new VercelSandboxProvider();
  const manager = SandboxManager.getInstance({
    provider,
    logger: options.logger,
  });

  await manager.init();

  const repositoryPrivate = isRepositoryPrivate(normalized);
  const shouldUseCloneAuth = repositoryPrivate !== false;

  const cloneAuth = shouldUseCloneAuth
    ? await createRepositoryCloneAuth(normalized)
    : null;

  console.info("[review-agent] sandbox auth strategy", {
    repositoryPrivate,
    usingInstallationAuth: shouldUseCloneAuth,
    installationIdPresent: shouldUseCloneAuth,
  });

  const sandbox = await manager.createSandbox({
    ownerId: `${normalized.repository.owner}/${normalized.repository.name}`,
    runtime: options.sandboxRuntime ?? DEFAULT_SANDBOX_RUNTIME,
    timeoutSeconds:
      options.sandboxTimeoutSeconds ?? DEFAULT_SANDBOX_TIMEOUT_SECONDS,
    source: {
      type: "git",
      url: getRepoUrl(normalized),
      revision: getRevision(normalized),
      username: cloneAuth?.username,
      password: cloneAuth?.password,
      depth: 20,
    },
    metadata: {
      pullRequestNumber: normalized.pullRequest.number,
      baseSha: normalized.pullRequest.baseSha,
      headSha: normalized.pullRequest.headSha,
      executionMode: "sandbox",
    },
  });

  try {
    console.info("[review-agent] sandbox created", {
      sandboxId: sandbox.id,
      provider: sandbox.provider,
      state: sandbox.state,
    });

    const cwdProbe = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
      timeoutMs: 10_000,
    });
    const sandboxRepositoryRoot =
      cwdProbe.exitCode === 0 && cwdProbe.stdout.trim().length > 0
        ? (cwdProbe.stdout.trim().split(/\r?\n/)[0] ?? "/workspace")
        : "/workspace";

    console.info("[review-agent] sandbox repository root", {
      sandboxId: sandbox.id,
      repositoryRoot: sandboxRepositoryRoot,
      probeExitCode: cwdProbe.exitCode,
      probeStdout: cwdProbe.stdout.trim().slice(0, 200),
      probeStderr: cwdProbe.stderr.trim().slice(0, 200),
    });

    const toolsRunner = createSandboxRepositoryToolsRunner({
      sandboxManager: manager,
      sandboxId: sandbox.id,
      repositoryRoot: sandboxRepositoryRoot,
    });

    const reviewPromise = runPrReviewWithRepositoryTools(normalized, {
      ...options,
      repositoryRoot: sandboxRepositoryRoot,
      repositoryToolsRunner: toolsRunner,
    });

    const result = await timeoutPromise(
      reviewPromise,
      options.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
      "Sandbox review timed out before completion.",
    );

    console.info("[review-agent] sandbox review complete", {
      sandboxId: sandbox.id,
      verdict: result.summary.verdict,
      findingsCount: result.findings.length,
      elapsedMs: result.summary.elapsedMs,
    });

    return result;
  } catch (error) {
    console.error("[review-agent] sandbox review failed", {
      sandboxId: sandbox.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw new SandboxReviewExecutionError("Sandbox review execution failed.", {
      cause: error,
    });
  } finally {
    try {
      await manager.stopSandbox(sandbox.id);
      console.info("[review-agent] sandbox stopped", {
        sandboxId: sandbox.id,
      });
    } catch (stopError) {
      console.warn("[review-agent] failed to stop sandbox", {
        sandboxId: sandbox.id,
        error:
          stopError instanceof Error ? stopError.message : String(stopError),
      });
    }
  }
}
