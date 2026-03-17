import {
  getPullRequest,
  listPullRequestFiles,
  upsertPullRequestComment,
} from "@pfe-monorepo/github-api";
import { createGitHubReviewModel, runReview } from "@pfe-monorepo/review-agent";
import { getGithubInstallationReviewer, savePullRequestReview } from "../db";
import {
  getInstallationId,
  getOwnerRepo,
  REVIEW_COMMENT_MARKER,
  toMarkdownReview,
} from "../helpers";
import type { PullRequestPayload } from "../types";

type HandlePullRequestEventArgs = {
  payload: unknown;
  deliveryId: string;
  eventName: string;
};

export const handlePullRequestEvent = async ({
  payload,
  deliveryId,
  eventName,
}: HandlePullRequestEventArgs): Promise<Response | null> => {
  const body = payload as PullRequestPayload;

  if (body.action !== "opened" && body.action !== "synchronize") {
    return null;
  }

  const installationId = getInstallationId(body.installation);
  const ownerRepo = getOwnerRepo(body.repository);
  const pullRequestNumber = body.pull_request?.number;

  if (
    !installationId ||
    !ownerRepo ||
    typeof pullRequestNumber !== "number" ||
    !Number.isInteger(pullRequestNumber)
  ) {
    console.warn("[github-webhook] pull_request ignored", {
      deliveryId,
      action: body.action,
      installationId,
      owner: ownerRepo?.owner,
      repo: ownerRepo?.repo,
      pullRequestNumber,
      reason: "missing_or_invalid_review_payload",
    });
    return null;
  }

  const githubInstallation =
    await getGithubInstallationReviewer(installationId);

  if (!githubInstallation) {
    console.warn("[github-webhook] pull_request ignored", {
      deliveryId,
      action: body.action,
      installationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      reason: "installation_not_linked_in_db",
    });
    return null;
  }

  const [pullRequest, files] = await Promise.all([
    getPullRequest(installationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
    }),
    listPullRequestFiles(installationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
    }),
  ]);

  const filesForReview = files
    .filter((file) => typeof file.patch === "string" && file.patch.length > 0)
    .map((file) => ({
      path: file.filename,
      status: file.status,
      patch: file.patch ?? undefined,
    }));

  if (filesForReview.length === 0) {
    console.warn("[github-webhook] pull_request review skipped", {
      deliveryId,
      action: body.action,
      installationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      reason: "no_patch_files_available",
    });
    return null;
  }

  const review = await runReview(
    {
      repository: {
        owner: ownerRepo.owner,
        name: ownerRepo.repo,
        defaultBranch: body.repository?.default_branch,
      },
      pullRequest: {
        number: pullRequest.number,
        title: pullRequest.title,
        body: body.pull_request?.body,
        baseSha: body.pull_request?.base?.sha ?? "unknown-base-sha",
        headSha: body.pull_request?.head?.sha ?? "unknown-head-sha",
        baseRef: body.pull_request?.base?.ref ?? pullRequest.baseRef,
        headRef: body.pull_request?.head?.ref ?? pullRequest.headRef,
      },
      files: filesForReview,
      metadata: {
        deliveryId,
        eventName,
        action: body.action,
        sender: body.sender?.login,
        pullRequestUrl: body.pull_request?.html_url,
      },
    },
    {
      model: createGitHubReviewModel(),
      useRepositoryTools: false,
    },
  );

  const reviewText = toMarkdownReview(review);
  const pullRequestUrl = body.pull_request?.html_url ?? pullRequest.htmlUrl;
  const reviewDbStatus = await savePullRequestReview({
    installationId,
    repository: body.repository,
    ownerRepo,
    pullRequestNumber: pullRequest.number,
    pullRequestTitle: pullRequest.title,
    pullRequestUrl,
    reviewText,
    reviewerClerkUserId: githubInstallation.user.clerkUserId,
  });

  await upsertPullRequestComment(installationId, {
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    pullRequestNumber,
    marker: REVIEW_COMMENT_MARKER,
    body: reviewText,
  });

  console.info("[github-webhook] pull_request review completed", {
    deliveryId,
    action: body.action,
    installationId,
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    pullRequestNumber,
    findingsCount: review.findings.length,
    verdict: review.summary.verdict,
    db: reviewDbStatus,
  });

  return null;
};
