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

    const currentName = getErrorString(current, "name");
    if (currentName === expectedName) {
      return true;
    }

    current = Reflect.get(current, "cause");
  }

  return false;
}

function isReviewOutputValidationFailure(error: unknown): boolean {
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
    message.includes("type validation failed")
  );
}

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

  const reviewInput = {
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
  };

  const model = createGitHubReviewModel();

  let review;

  try {
    review = await runReview(reviewInput, {
      model,
      useRepositoryTools: true,
    });
  } catch (error) {
    if (!isReviewOutputValidationFailure(error)) {
      throw error;
    }

    console.warn(
      "[github-webhook] pull_request tool review failed schema validation; retrying without tools",
      {
        deliveryId,
        installationId,
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        pullRequestNumber,
        errorName: getErrorString(error, "name") || "UnknownError",
        errorCode: getErrorString(error, "code") || undefined,
        errorMessage: getErrorString(error, "message") || "Unknown error",
      },
    );

    review = await runReview(reviewInput, {
      model,
      useRepositoryTools: false,
    });
  }

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
