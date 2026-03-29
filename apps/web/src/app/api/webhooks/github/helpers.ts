import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReviewResult } from "@pfe-monorepo/review-agent";
import type { GitHubInstallation, PullRequestPayload } from "./types";

export const REVIEW_COMMENT_MARKER = "<!-- pfe-review-agent -->";

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

export const getInstallationId = (
  installation?: GitHubInstallation,
): number | null => {
  const value = installation?.id;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

export const getOwnerRepo = (
  repository?: PullRequestPayload["repository"],
): { owner: string; repo: string } | null => {
  const owner = repository?.owner?.login?.trim();
  const repo = repository?.name?.trim();

  if (owner && repo) {
    return { owner, repo };
  }

  const fullName = repository?.full_name?.trim();
  if (!fullName) {
    return null;
  }

  const [fullNameOwner, fullNameRepo] = fullName.split("/");
  if (!fullNameOwner || !fullNameRepo) {
    return null;
  }

  return {
    owner: fullNameOwner,
    repo: fullNameRepo,
  };
};

export const toMarkdownReview = (review: ReviewResult): string => {
  const findingLines = review.findings.map((finding) => {
    const suggestionLine = finding.suggestion
      ? formatSuggestionSection(finding.suggestion)
      : "";

    return [finding.message, suggestionLine].filter(Boolean).join("\n\n");
  });

  return [
    REVIEW_COMMENT_MARKER,
    "## Automated PR Review",
    `- Verdict: **${review.summary.verdict.toUpperCase()}**`,
    `- Score: **${review.summary.score}/100**`,
    `- Risk: ${review.summary.risk}`,
    "",
    review.summary.overview,
    "",
    review.findings.length > 0
      ? "### Findings\n" + findingLines.join("\n\n")
      : "### Findings\nNo blocking findings detected.",
    review.notes?.length ? `\n### Notes\n${review.notes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const parseSignature = (value: string) => {
  const parts = value.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return null;
  }

  return parts[1];
};

export const isValidSignature = (
  payload: string,
  secret: string,
  signatureHeader: string,
): boolean => {
  const signature = parseSignature(signatureHeader);
  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
};
