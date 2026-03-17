import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReviewResult } from "@pfe-monorepo/review-agent";
import type { GitHubInstallation, PullRequestPayload } from "./types";

export const REVIEW_COMMENT_MARKER = "<!-- pfe-review-agent -->";

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
  const findingLines = review.findings.map((finding, index) => {
    const location = finding.line
      ? ` (${finding.file}:${finding.line})`
      : ` (${finding.file})`;
    const suggestion = finding.suggestion
      ? `\nSuggestion: ${finding.suggestion}`
      : "";

    return `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}${location}\n${finding.message}${suggestion}`;
  });

  return [
    REVIEW_COMMENT_MARKER,
    "## Automated PR Review",
    `Verdict: **${review.summary.verdict}**`,
    `Score: **${review.summary.score}/100**`,
    `Risk: ${review.summary.risk}`,
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
