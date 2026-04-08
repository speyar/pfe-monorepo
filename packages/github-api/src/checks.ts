import { normalizeGitHubError } from "./errors";
import { getGitHubClient } from "./lib/get-github-client";
import type { GitHubOwnerRepo } from "./types";

export type CheckRunStatus = "queued" | "in_progress" | "completed";

export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "skipped"
  | "stale";

export type CreateCheckRunInput = GitHubOwnerRepo & {
  name: string;
  headSha: string;
  detailsUrl?: string;
  title?: string;
  summary: string;
  text?: string;
};

export type UpdateCheckRunInput = GitHubOwnerRepo & {
  checkRunId: number;
  status: CheckRunStatus;
  conclusion?: CheckRunConclusion;
  detailsUrl?: string;
  title?: string;
  summary?: string;
  text?: string;
};

export type CheckRunResult = {
  id: number;
  htmlUrl: string | null;
  status: string;
  conclusion: string | null;
};

export const createCheckRun = async (
  installationId: number,
  input: CreateCheckRunInput,
): Promise<CheckRunResult> => {
  try {
    const client = await getGitHubClient(installationId);
    const response = await client.rest.checks.create({
      owner: input.owner,
      repo: input.repo,
      name: input.name,
      head_sha: input.headSha,
      status: "in_progress",
      details_url: input.detailsUrl,
      output: {
        title: input.title ?? input.name,
        summary: input.summary,
        text: input.text,
      },
    });

    return {
      id: response.data.id,
      htmlUrl: response.data.html_url,
      status: response.data.status,
      conclusion: response.data.conclusion,
    };
  } catch (error) {
    console.error("[github-api] Failed to create check run error details:", {
      installationId,
      owner: input.owner,
      repo: input.repo,
      name: input.name,
      headSha: input.headSha,
      error: error instanceof Error ? error.message : String(error),
      errorCause: error instanceof Error ? error.cause : undefined,
      errorInfo:
        error instanceof Error && "info" in error
          ? (error as any).info
          : undefined,
    });
    throw normalizeGitHubError(error, "Failed to create check run");
  }
};

export const updateCheckRun = async (
  installationId: number,
  input: UpdateCheckRunInput,
): Promise<CheckRunResult> => {
  try {
    const client = await getGitHubClient(installationId);
    const response = await client.rest.checks.update({
      owner: input.owner,
      repo: input.repo,
      check_run_id: input.checkRunId,
      status: input.status,
      conclusion: input.conclusion,
      details_url: input.detailsUrl,
      completed_at:
        input.status === "completed" ? new Date().toISOString() : undefined,
      output:
        input.summary || input.title || input.text
          ? {
              title: input.title ?? "Automated PR Review",
              summary: input.summary ?? "",
              text: input.text,
            }
          : undefined,
    });

    return {
      id: response.data.id,
      htmlUrl: response.data.html_url,
      status: response.data.status,
      conclusion: response.data.conclusion,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to update check run");
  }
};
