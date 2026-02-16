import { normalizeGitHubError } from "./errors";
import type { GitHubClient, GitHubOwnerRepo } from "./types";

export type CreatePullRequestCommentInput = GitHubOwnerRepo & {
  pullRequestNumber: number;
  body: string;
};

export type UpdateCommentInput = GitHubOwnerRepo & {
  commentId: number;
  body: string;
};

export type DeleteCommentInput = GitHubOwnerRepo & {
  commentId: number;
};

export type CreatePullRequestReviewCommentInput = GitHubOwnerRepo & {
  pullRequestNumber: number;
  body: string;
  commitSha: string;
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
};

export type UpsertPullRequestCommentInput = CreatePullRequestCommentInput & {
  marker: string;
};

export type PullRequestCommentResult = {
  commentId: number;
  body: string;
  htmlUrl: string;
  updatedAt: string;
};

export const createPullRequestComment = async (
  client: GitHubClient,
  input: CreatePullRequestCommentInput
): Promise<PullRequestCommentResult> => {
  try {
    const response = await client.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pullRequestNumber,
      body: input.body,
    });

    return {
      commentId: response.data.id,
      body: response.data.body ?? "",
      htmlUrl: response.data.html_url,
      updatedAt: response.data.updated_at,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to create pull request comment");
  }
};

export const createPullRequestReviewComment = async (
  client: GitHubClient,
  input: CreatePullRequestReviewCommentInput
): Promise<PullRequestCommentResult> => {
  try {
    const response = await client.rest.pulls.createReviewComment({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
      body: input.body,
      commit_id: input.commitSha,
      path: input.path,
      line: input.line,
      side: input.side,
    });

    return {
      commentId: response.data.id,
      body: response.data.body ?? "",
      htmlUrl: response.data.html_url,
      updatedAt: response.data.updated_at,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to create pull request review comment");
  }
};

export const updateComment = async (
  client: GitHubClient,
  input: UpdateCommentInput
): Promise<PullRequestCommentResult> => {
  try {
    const response = await client.rest.issues.updateComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: input.commentId,
      body: input.body,
    });

    return {
      commentId: response.data.id,
      body: response.data.body ?? "",
      htmlUrl: response.data.html_url,
      updatedAt: response.data.updated_at,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to update comment");
  }
};

export const deleteComment = async (
  client: GitHubClient,
  input: DeleteCommentInput
): Promise<void> => {
  try {
    await client.rest.issues.deleteComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: input.commentId,
    });
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to delete comment");
  }
};

export const upsertPullRequestComment = async (
  client: GitHubClient,
  input: UpsertPullRequestCommentInput
): Promise<PullRequestCommentResult> => {
  try {
    const comments = await client.paginate(client.rest.issues.listComments, {
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pullRequestNumber,
      per_page: 100,
    });

    const matchingComment = comments.find((comment) => {
      if (!comment.body) {
        return false;
      }

      return comment.body.includes(input.marker);
    });

    if (!matchingComment) {
      return createPullRequestComment(client, input);
    }

    return updateComment(client, {
      owner: input.owner,
      repo: input.repo,
      commentId: matchingComment.id,
      body: input.body,
    });
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to upsert pull request comment");
  }
};
