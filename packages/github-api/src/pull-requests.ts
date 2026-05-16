import { normalizeGitHubError } from "./errors";
import { getGitHubClient } from "./lib/get-github-client";
import type {
  GitHubClient,
  GitHubOwnerRepo,
  PullRequestDiff,
  PullRequestFile,
  PullRequestSummary,
} from "./types";

export type GetPullRequestInput = GitHubOwnerRepo & {
  pullRequestNumber: number;
};

export const getPullRequest = async (
  installationId: number,
  input: GetPullRequestInput,
): Promise<PullRequestSummary> => {
  try {
    const client = await getGitHubClient(installationId);
    const response = await client.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
    });

    const data = response.data;

    return {
      id: data.id,
      number: data.number,
      title: data.title,
      state: data.state,
      draft: data.draft ?? false,
      mergeable: data.mergeable,
      headRef: data.head.ref,
      baseRef: data.base.ref,
      htmlUrl: data.html_url,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to fetch pull request");
  }
};

export const listPullRequestFiles = async (
  installationId: number,
  input: GetPullRequestInput,
): Promise<PullRequestFile[]> => {
  try {
    const client = await getGitHubClient(installationId);
    const response = await client.paginate(client.rest.pulls.listFiles, {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      per_page: 100,
    });

    return response.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      blobUrl: file.blob_url,
      patch: file.patch ?? null,
    }));
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to list pull request files");
  }
};

export type CreatePullRequestInput = GitHubOwnerRepo & {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
};

export const createPullRequest = async (
  installationId: number,
  input: CreatePullRequestInput,
): Promise<{ htmlUrl: string; number: number }> => {
  try {
    const client = await getGitHubClient(installationId);
    const response = await client.rest.pulls.create({
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft ?? false,
    });

    return {
      htmlUrl: response.data.html_url,
      number: response.data.number,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to create pull request");
  }
};

export const getPullRequestDiff = async (
  client: GitHubClient,
  input: GetPullRequestInput,
): Promise<PullRequestDiff> => {
  try {
    const response = await client.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullRequestNumber,
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
      },
    );

    return {
      repository: {
        owner: input.owner,
        repo: input.repo,
      },
      pullRequestNumber: input.pullRequestNumber,
      diff: typeof response.data === "string" ? response.data : "",
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to fetch pull request diff");
  }
};
