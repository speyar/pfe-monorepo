import {
  createPullRequestReviewComment,
  getPullRequest,
  listPullRequestFiles,
  upsertPullRequestComment,
} from "@pfe-monorepo/github-api";
import {
  createGitHubReviewModel,
  type ReviewFinding,
  type ReviewResult,
  runReview,
} from "@pfe-monorepo/review-agent";
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

type DiffSide = "LEFT" | "RIGHT";

type DiffLineMaps = {
  right: Map<number, string>;
  left: Map<number, string>;
};

type InlineTarget = {
  path: string;
  line: number;
  side: DiffSide;
  snippet: string[];
};

type InlineTargetResolution =
  | { ok: true; target: InlineTarget }
  | { ok: false; reason: string };

const MAX_INLINE_SNIPPET_LINES = 3;

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function parsePatchLineMaps(patch: string): DiffLineMaps {
  const right = new Map<number, string>();
  const left = new Map<number, string>();

  const lines = patch.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of lines) {
    const hunkHeader = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(
      rawLine,
    );

    if (hunkHeader) {
      oldLine = Number.parseInt(hunkHeader[1], 10);
      newLine = Number.parseInt(hunkHeader[2], 10);
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (!rawLine) {
      continue;
    }

    const marker = rawLine[0];

    if (marker === "+") {
      right.set(newLine, rawLine);
      newLine += 1;
      continue;
    }

    if (marker === "-") {
      left.set(oldLine, rawLine);
      oldLine += 1;
      continue;
    }

    if (marker === " ") {
      right.set(newLine, rawLine);
      left.set(oldLine, rawLine);
      oldLine += 1;
      newLine += 1;
    }
  }

  return { right, left };
}

function buildSnippet(
  sideMap: Map<number, string>,
  targetLine: number,
): string[] {
  const snippet: string[] = [];

  for (let offset = -1; offset <= 1; offset += 1) {
    const lineNumber = targetLine + offset;
    const line = sideMap.get(lineNumber);

    if (!line) {
      continue;
    }

    snippet.push(`${lineNumber}: ${line}`);
    if (snippet.length >= MAX_INLINE_SNIPPET_LINES) {
      break;
    }
  }

  return snippet;
}

function buildInlineCommentBody(
  finding: ReviewFinding,
  target: InlineTarget,
): string {
  const snippetSection =
    target.snippet.length > 0
      ? `${target.snippet.map((line) => `> ${line}`).join("\n")}\n\n`
      : "";
  const suggestionSection = finding.suggestion
    ? `\n\nSuggestion: ${finding.suggestion}`
    : "";

  return `[${finding.severity.toUpperCase()}] ${finding.title}\n\n${snippetSection}${finding.message}${suggestionSection}`;
}

function resolveInlineTarget(
  finding: ReviewFinding,
  patchByPath: Map<string, string>,
  lineMapsByPath: Map<string, DiffLineMaps>,
): InlineTargetResolution {
  if (typeof finding.line !== "number") {
    return { ok: false, reason: "missing_line" };
  }

  const normalizedPath = normalizePath(finding.file);
  const patch = patchByPath.get(normalizedPath);
  if (!patch) {
    return { ok: false, reason: "file_not_in_changed_diff" };
  }

  let maps = lineMapsByPath.get(normalizedPath);
  if (!maps) {
    maps = parsePatchLineMaps(patch);
    lineMapsByPath.set(normalizedPath, maps);
  }

  const rightLine = maps.right.get(finding.line);
  if (rightLine) {
    return {
      ok: true,
      target: {
        path: normalizedPath,
        line: finding.line,
        side: "RIGHT",
        snippet: buildSnippet(maps.right, finding.line),
      },
    };
  }

  const leftLine = maps.left.get(finding.line);
  if (leftLine) {
    return {
      ok: true,
      target: {
        path: normalizedPath,
        line: finding.line,
        side: "LEFT",
        snippet: buildSnippet(maps.left, finding.line),
      },
    };
  }

  return { ok: false, reason: "line_not_in_changed_hunks" };
}

function buildFallbackSummaryComment(input: {
  totalFindings: number;
  postedInline: number;
  skippedByReason: Record<string, number>;
}): string {
  const skipped = input.totalFindings - input.postedInline;
  const reasonLines = Object.entries(input.skippedByReason)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `- ${reason}: ${count}`);

  return [
    REVIEW_COMMENT_MARKER,
    "## Automated PR Review",
    `Inline comments posted: ${input.postedInline}/${input.totalFindings}`,
    skipped > 0 ? "Skipped findings:" : "",
    skipped > 0 ? reasonLines.join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

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

  let review: ReviewResult;

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

  const patchByPath = new Map<string, string>();
  for (const file of files) {
    if (!file.patch) {
      continue;
    }

    patchByPath.set(normalizePath(file.filename), file.patch);
  }

  const lineMapsByPath = new Map<string, DiffLineMaps>();
  const skippedByReason: Record<string, number> = {};
  let postedInline = 0;

  const commitSha = body.pull_request?.head?.sha;
  if (commitSha) {
    for (const finding of review.findings) {
      const targetResolution = resolveInlineTarget(
        finding,
        patchByPath,
        lineMapsByPath,
      );

      if (!targetResolution.ok) {
        skippedByReason[targetResolution.reason] =
          (skippedByReason[targetResolution.reason] ?? 0) + 1;
        continue;
      }

      const commentBody = buildInlineCommentBody(
        finding,
        targetResolution.target,
      );

      await createPullRequestReviewComment(installationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        pullRequestNumber,
        commitSha,
        path: targetResolution.target.path,
        line: targetResolution.target.line,
        side: targetResolution.target.side,
        body: commentBody,
      });

      postedInline += 1;
    }
  } else {
    skippedByReason.missing_commit_sha = review.findings.length;
  }

  if (postedInline < review.findings.length) {
    const fallbackComment = buildFallbackSummaryComment({
      totalFindings: review.findings.length,
      postedInline,
      skippedByReason,
    });

    await upsertPullRequestComment(installationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      marker: REVIEW_COMMENT_MARKER,
      body: fallbackComment,
    });
  }

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

  console.info("[github-webhook] pull_request review completed", {
    deliveryId,
    action: body.action,
    installationId,
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    pullRequestNumber,
    findingsCount: review.findings.length,
    inlineCommentsPosted: postedInline,
    inlineCommentsSkipped: review.findings.length - postedInline,
    skippedByReason,
    verdict: review.summary.verdict,
    db: reviewDbStatus,
  });

  return null;
};
