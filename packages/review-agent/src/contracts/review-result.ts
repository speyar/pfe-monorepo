export const REVIEW_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_VERDICTS = [
  "approve",
  "comment",
  "request_changes",
] as const;

export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface ReviewFinding {
  severity: ReviewSeverity;
  file: string;
  line?: number;
  endLine?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
  category?: string;
  confidence?: number;
}

export interface ReviewSummary {
  verdict: ReviewVerdict;
  score: number;
  overview: string;
  risk: string;
  model?: string;
  elapsedMs?: number;
}

export interface ReviewResult {
  summary: ReviewSummary;
  findings: ReviewFinding[];
  notes?: string[];
}
