import type { NormalizedReviewRequest } from "../core/normalize-input";

const REVIEW_FOCUS = [
  "Correctness and logic flaws",
  "Security vulnerabilities",
  "Performance issues",
  "Maintainability and readability",
];

export const DEFAULT_REVIEW_SYSTEM_PROMPT = [
  "You are an expert code reviewer analyzing pull request changes.",
  "Analyze only the provided repository, pull request metadata, and changed file context.",
  "Return only valid JSON matching the expected response schema with no markdown and no code fences.",
  "Do not include keys outside schema and do not include explanatory text outside JSON fields.",
  "Use this schema exactly: { summary: { verdict: 'approve' | 'comment' | 'request_changes', score: 0-100, overview: string, risk: string }, findings: [{ severity: 'critical' | 'high' | 'medium' | 'low' | 'info', file: string, line?: number, endLine?: number, title: string, message: string, suggestion?: string, category?: string, confidence?: 0-1 }], notes?: string[] }.",
  "Only reference files and lines that exist in the provided diff/context; never invent file paths or line numbers.",
  "If exact line is unknown, omit line/endLine instead of guessing.",
  "Focus on correctness, security, performance, and maintainability.",
  "Avoid duplicates and generic advice; findings must be actionable and specific.",
  "Keep findings short: title <= 10 words, message <= 2 sentences, suggestion <= 1 sentence.",
  "Minimize noise: report only material issues and prefer fewer high-confidence findings.",
  "If no material issue exists, set summary.verdict to 'approve' and return an empty findings array.",
  "Keep results concise and prioritize high-impact findings.",
].join(" ");

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...<truncated>`;
}

function formatFileContext(input: NormalizedReviewRequest): string {
  return input.files
    .map((file) => {
      const patchOrContent = file.patch ?? file.content ?? "";
      const body = truncate(patchOrContent, input.config.maxPatchCharsPerFile);
      const status = file.status ?? "modified";

      return [
        `### File: ${file.path}`,
        `Status: ${status}`,
        file.language ? `Language: ${file.language}` : "",
        body ? `\n${body}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function buildReviewPrompt(input: NormalizedReviewRequest): string {
  const focusAreas = input.config.focusAreas.length
    ? input.config.focusAreas
    : REVIEW_FOCUS;

  return [
    `Repository: ${input.repository.owner}/${input.repository.name}`,
    `Pull request: #${input.pullRequest.number} ${input.pullRequest.title}`,
    `Base SHA: ${input.pullRequest.baseSha}`,
    `Head SHA: ${input.pullRequest.headSha}`,
    input.pullRequest.body ? `Description:\n${input.pullRequest.body}` : "",
    `Focus areas: ${focusAreas.join(", ")}`,
    `Max findings: ${input.config.maxFindings}`,
    `Include suggestions: ${input.config.includeSuggestions ? "yes" : "no"}`,
    "\nChanged files context:\n",
    formatFileContext(input),
    "\nOutput requirements:",
    "- Be precise and reference concrete files/lines when possible.",
    "- Keep findings unique and prioritize high-impact issues.",
    "- Keep titles and messages concise and direct.",
    "- Do not include markdown code fences in fields.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
