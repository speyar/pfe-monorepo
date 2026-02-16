import { normalizeGitHubError } from "./errors";
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
  client: GitHubClient,
  input: GetPullRequestInput
): Promise<PullRequestSummary> => {
  try {
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
  client: GitHubClient,
  input: GetPullRequestInput
): Promise<PullRequestFile[]> => {
  try {
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

export const getPullRequestDiff = async (
  client: GitHubClient,
  input: GetPullRequestInput
): Promise<PullRequestDiff> => {
  try {
    const response = await client.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
    });

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
