import { ReviewResult } from "../contracts/review-result";
import { OutputValidationError } from "../errors/review-errors";
import { reviewResultSchema } from "../schema/review-result.schema";

import type { NormalizedReviewRequest } from "./normalize-input";

export function validateReviewResult(
  value: unknown,
  request: NormalizedReviewRequest,
): ReviewResult {
  const parsed = reviewResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new OutputValidationError(
      "Model output does not match the expected review result schema.",
      parsed.error,
    );
  }

  let findings = parsed.data.findings;

  if (!request.config.includeInfoFindings) {
    findings = findings.filter((finding) => finding.severity !== "info");
  }

  findings = findings.slice(0, request.config.maxFindings);

  if (!request.config.includeSuggestions) {
    findings = findings.map((finding) => ({
      ...finding,
      suggestion: undefined,
    }));
  }

  return {
    ...parsed.data,
    findings,
  };
}
