import {
  createCheckRun,
  createPullRequestReviewComment,
  getPullRequest,
  listPullRequestFiles,
  updateCheckRun,
  upsertPullRequestComment,
} from "@pfe-monorepo/github-api";
import {
  runPullRequestReviewV2,
  type PullRequestReviewFindingV2 as ReviewFinding,
  type PullRequestReviewResultV2 as ReviewResult,
} from "@pfe-monorepo/new-review-agent";
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

const MAX_INLINE_SNIPPET_LINES = 5;
const REVIEW_STATUS_MARKER = "<!-- pfe-review-agent-status -->";

function buildReviewStatusComment(
  state: "in_progress" | "completed" | "failed",
): string {
  if (state === "completed") {
    return [
      REVIEW_STATUS_MARKER,
      "✅ Review completed. See review below.",
    ].join("\n");
  }

  if (state === "failed") {
    return [
      REVIEW_STATUS_MARKER,
      "⚠️ Review failed before completion. Please retry.",
    ].join("\n");
  }

  return [REVIEW_STATUS_MARKER, "⏳ AI review in progress"].join("\n");
}

function buildCheckSummary(lines: string[]): string {
  return lines.join("\n");
}

function looksLikeCode(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).length;
  const startsLikeSentence = /^[A-Z][a-z]+(\s|$)/.test(trimmed);
  const hasInlineCodeTicks = trimmed.includes("`");
  const startsLikeCode =
    /^(if|for|while|switch|return|const|let|var|await|throw|import|export|function|class)\b/.test(
      trimmed,
    ) || /^[A-Za-z_$][\w$.\]]*\s*(=|\+=|-=|\*=|\/=|\(|\[)/.test(trimmed);
  const endsLikeCode = /[;{}]$/.test(trimmed);

  if (startsLikeSentence && wordCount >= 5 && !endsLikeCode) {
    return false;
  }

  if (hasInlineCodeTicks && startsLikeSentence) {
    return false;
  }

  return startsLikeCode || endsLikeCode;
}

function extractCodeFromSuggestion(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const hrefMatch = /^change\s+href\s+to\s+["']([^"']+)["']/i.exec(trimmed);
  if (hrefMatch) {
    return `href="${hrefMatch[1]}"`;
  }

  const srcMatch = /^update\s+src\s+to\s+["']([^"']+)["']/i.exec(trimmed);
  if (srcMatch) {
    return `src="${srcMatch[1]}"`;
  }

  const callMatch = /^call\s+([A-Za-z_$][\w$]*\([^)]*\))/i.exec(trimmed);
  if (callMatch) {
    return callMatch[1];
  }

  const passMatch =
    /^pass\s+([A-Za-z_$][\w$]*)\s+to\s+([A-Za-z_$][\w$]*)/i.exec(trimmed);
  if (passMatch) {
    return `${passMatch[2]}(${passMatch[1]})`;
  }

  const backtickMatches = [...trimmed.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  const backtickCode = backtickMatches.find((candidate) => {
    if (!/[A-Za-z_$]/.test(candidate)) {
      return false;
    }

    return /[().=!+\-/*\[\]{}'"<>]|\./.test(candidate);
  });

  if (backtickCode) {
    return backtickCode;
  }

  if (looksLikeCode(trimmed)) {
    return trimmed;
  }

  return null;
}

function formatSuggestionSection(suggestion: string): string {
  const normalized = suggestion.trim();
  if (!normalized) {
    return "";
  }

  const lineCount = normalized.split(/\r?\n/).length;

  if (lineCount === 1) {
    const codeCandidate = extractCodeFromSuggestion(normalized);
    if (codeCandidate) {
      return ["```suggestion", codeCandidate, "```"].join("\n");
    }
  }

  return normalized;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeCodeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function chooseClosestLine(
  lines: number[],
  preferredLine?: number,
): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }

  if (typeof preferredLine !== "number") {
    return lines[0];
  }

  return lines.reduce((closest, current) => {
    const currentDistance = Math.abs(current - preferredLine);
    const closestDistance = Math.abs(closest - preferredLine);

    return currentDistance < closestDistance ? current : closest;
  }, lines[0]);
}

function findLineByQuote(
  sideMap: Map<number, string>,
  quote: string,
  preferredLine?: number,
): number | undefined {
  const quoteTrimmed = quote.trim();
  if (!quoteTrimmed) {
    return undefined;
  }

  const exactChanged: number[] = [];
  const exactContext: number[] = [];
  const normalizedChanged: number[] = [];
  const normalizedContext: number[] = [];
  const includeChanged: number[] = [];
  const includeContext: number[] = [];
  const normalizedQuote = normalizeCodeForComparison(quoteTrimmed);
  const normalizedQuoteLower = normalizedQuote.toLowerCase();

  for (const [lineNumber, rawLine] of sideMap.entries()) {
    const marker = rawLine[0];
    const isChangedLine = marker === "+" || marker === "-";
    const content = rawLine.slice(1);
    const contentTrimmed = content.trim();
    if (!contentTrimmed) {
      continue;
    }

    if (contentTrimmed === quoteTrimmed) {
      (isChangedLine ? exactChanged : exactContext).push(lineNumber);
      continue;
    }

    const normalizedContent = normalizeCodeForComparison(contentTrimmed);
    if (normalizedContent === normalizedQuote) {
      (isChangedLine ? normalizedChanged : normalizedContext).push(lineNumber);
      continue;
    }

    const normalizedContentLower = normalizedContent.toLowerCase();
    if (
      normalizedContentLower.includes(normalizedQuoteLower) ||
      normalizedQuoteLower.includes(normalizedContentLower)
    ) {
      (isChangedLine ? includeChanged : includeContext).push(lineNumber);
    }
  }

  return (
    chooseClosestLine(exactChanged, preferredLine) ??
    chooseClosestLine(normalizedChanged, preferredLine) ??
    chooseClosestLine(includeChanged, preferredLine) ??
    chooseClosestLine(exactContext, preferredLine) ??
    chooseClosestLine(normalizedContext, preferredLine) ??
    chooseClosestLine(includeContext, preferredLine)
  );
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

    const marker =
      line[0] === "+" || line[0] === "-" || line[0] === " " ? line[0] : " ";
    const content = line.slice(1);

    snippet.push(
      `${lineNumber.toString().padStart(4, " ")} ${marker} ${content}`,
    );
    if (snippet.length >= MAX_INLINE_SNIPPET_LINES) {
      break;
    }
  }

  return snippet;
}

function buildInlineCommentBody(
  finding: ReviewFinding,
  _target: InlineTarget,
): string {
  const suggestionSection = finding.suggestion
    ? formatSuggestionSection(finding.suggestion)
    : "";

  const bodyParts = [finding.message];
  if (suggestionSection) {
    bodyParts.push("", suggestionSection);
  }

  return bodyParts.join("\n");
}

function resolveInlineTarget(
  finding: ReviewFinding,
  patchByPath: Map<string, string>,
  lineMapsByPath: Map<string, DiffLineMaps>,
): InlineTargetResolution {
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

  const quotedCode = finding.quote?.trim();
  if (quotedCode) {
    const rightQuotedLine = findLineByQuote(
      maps.right,
      quotedCode,
      finding.line,
    );
    if (typeof rightQuotedLine === "number") {
      return {
        ok: true,
        target: {
          path: normalizedPath,
          line: rightQuotedLine,
          side: "RIGHT",
          snippet: buildSnippet(maps.right, rightQuotedLine),
        },
      };
    }

    const leftQuotedLine = findLineByQuote(maps.left, quotedCode, finding.line);
    if (typeof leftQuotedLine === "number") {
      return {
        ok: true,
        target: {
          path: normalizedPath,
          line: leftQuotedLine,
          side: "LEFT",
          snippet: buildSnippet(maps.left, leftQuotedLine),
        },
      };
    }
  }

  if (typeof finding.line !== "number") {
    return { ok: false, reason: "missing_line" };
  }

  const rightLine = maps.right.get(finding.line);
  if (rightLine) {
    const marker = rightLine[0];
    const isChanged = marker === "+";
    if (!quotedCode && !isChanged) {
      return { ok: false, reason: "line_points_to_context_only" };
    }

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
    const marker = leftLine[0];
    const isChanged = marker === "-";
    if (!quotedCode && !isChanged) {
      return { ok: false, reason: "line_points_to_context_only" };
    }

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

  const pullRequestUrl = body.pull_request?.html_url ?? pullRequest.htmlUrl;
  await upsertPullRequestComment(installationId, {
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    pullRequestNumber,
    marker: REVIEW_STATUS_MARKER,
    body: buildReviewStatusComment("in_progress"),
  });

  const checkRunHeadSha = body.pull_request?.head?.sha;
  const checkRun = checkRunHeadSha
    ? await createCheckRun(installationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        name: "review-agent",
        headSha: checkRunHeadSha,
        detailsUrl: pullRequestUrl,
        title: "Automated PR Review",
        summary: buildCheckSummary([
          "Review in progress",
          "",
          "[====      ] scanning changed files",
          "[=======   ] tracing impacted code",
          "[==========] generating findings",
        ]),
      }).catch((error) => {
        console.error("[github-webhook] failed to create review check run", {
          deliveryId,
          installationId,
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          pullRequestNumber,
          headSha: checkRunHeadSha,
          error: error instanceof Error ? error.message : String(error),
          errorCause: error instanceof Error ? error.cause : undefined,
        });
        return null;
      })
    : null;

  try {
    const review: ReviewResult = await runPullRequestReviewV2({
      installationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      headRef: body.pull_request?.head?.ref ?? pullRequest.headRef,
      baseRef: body.pull_request?.base?.ref ?? pullRequest.baseRef,
    });

    console.info("[github-webhook] v2 review result", {
      deliveryId,
      installationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      verdict: review.summary.verdict,
      score: review.summary.score,
      risk: review.summary.risk,
      findingsCount: review.findings.length,
      notes: review.notes,
    });

    if (review.findings.length === 0) {
      const notesText = (review.notes ?? []).join("\n").toLowerCase();
      const dueToError =
        notesText.includes("encountered an error") ||
        notesText.includes("error details:");

      console.warn("[github-webhook] v2 review returned zero findings", {
        deliveryId,
        installationId,
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        pullRequestNumber,
        verdict: review.summary.verdict,
        reason: dueToError ? "error_fallback" : "clean_no_findings",
        notes: review.notes,
      });
    }

    if (checkRun) {
      await updateCheckRun(installationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        checkRunId: checkRun.id,
        status: "in_progress",
        detailsUrl: pullRequestUrl,
        title: "Automated PR Review",
        summary: buildCheckSummary([
          "Analysis complete",
          "Publishing comments to GitHub",
        ]),
      }).catch(() => {
        return;
      });
    }

    const reviewText = toMarkdownReview(review);

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

    if (checkRun) {
      await updateCheckRun(installationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        checkRunId: checkRun.id,
        status: "completed",
        conclusion: "success",
        detailsUrl: pullRequestUrl,
        title: "Automated PR Review",
        summary: buildCheckSummary([
          "Review completed",
          `Findings: ${review.findings.length}`,
          `Inline comments posted: ${postedInline}`,
        ]),
      }).catch(() => {
        return;
      });
    }

    await upsertPullRequestComment(installationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      marker: REVIEW_STATUS_MARKER,
      body: buildReviewStatusComment("completed"),
    });

    return null;
  } catch (error) {
    if (checkRun) {
      await updateCheckRun(installationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        checkRunId: checkRun.id,
        status: "completed",
        conclusion: "failure",
        detailsUrl: pullRequestUrl,
        title: "Automated PR Review",
        summary: "Review failed before completion.",
      }).catch(() => {
        return;
      });
    }

    await upsertPullRequestComment(installationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      marker: REVIEW_STATUS_MARKER,
      body: buildReviewStatusComment("failed"),
    }).catch(() => {
      return;
    });

    throw error;
  }
};
