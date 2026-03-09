import type {
  ReviewRequest,
  ReviewRequestConfig,
  ReviewRequestFile,
} from "../contracts/review-request";
import { InputValidationError } from "../errors/review-errors";

export interface NormalizedReviewRequestConfig {
  maxFindings: number;
  includeSuggestions: boolean;
  includeInfoFindings: boolean;
  focusAreas: string[];
  maxPatchCharsPerFile: number;
}

export interface NormalizedReviewRequest extends Omit<
  ReviewRequest,
  "config" | "files"
> {
  files: ReviewRequestFile[];
  config: NormalizedReviewRequestConfig;
}

export const DEFAULT_REVIEW_CONFIG: NormalizedReviewRequestConfig = {
  maxFindings: 20,
  includeSuggestions: true,
  includeInfoFindings: false,
  focusAreas: ["correctness", "security", "performance", "maintainability"],
  maxPatchCharsPerFile: 6_000,
};

function normalizeConfig(
  config?: ReviewRequestConfig,
): NormalizedReviewRequestConfig {
  const merged: NormalizedReviewRequestConfig = {
    ...DEFAULT_REVIEW_CONFIG,
    ...config,
    focusAreas: config?.focusAreas?.length
      ? config.focusAreas.filter((area) => area.trim().length > 0)
      : [...DEFAULT_REVIEW_CONFIG.focusAreas],
  };

  if (
    !Number.isInteger(merged.maxFindings) ||
    merged.maxFindings < 1 ||
    merged.maxFindings > 100
  ) {
    throw new InputValidationError(
      "config.maxFindings must be an integer between 1 and 100.",
    );
  }

  if (
    !Number.isInteger(merged.maxPatchCharsPerFile) ||
    merged.maxPatchCharsPerFile < 500 ||
    merged.maxPatchCharsPerFile > 100_000
  ) {
    throw new InputValidationError(
      "config.maxPatchCharsPerFile must be an integer between 500 and 100000.",
    );
  }

  return merged;
}

function normalizeFiles(files: ReviewRequestFile[]): ReviewRequestFile[] {
  if (!files.length) {
    throw new InputValidationError(
      "At least one changed file is required for review.",
    );
  }

  const deduped = new Map<string, ReviewRequestFile>();
  for (const file of files) {
    const normalizedPath = file.path.trim();
    if (!normalizedPath) {
      continue;
    }

    deduped.set(normalizedPath, {
      ...file,
      path: normalizedPath,
    });
  }

  if (!deduped.size) {
    throw new InputValidationError(
      "No valid file paths were provided in review request.",
    );
  }

  return [...deduped.values()];
}

export function normalizeReviewRequest(
  input: ReviewRequest,
): NormalizedReviewRequest {
  const owner = input.repository.owner.trim();
  const name = input.repository.name.trim();
  const title = input.pullRequest.title.trim();
  const baseSha = input.pullRequest.baseSha.trim();
  const headSha = input.pullRequest.headSha.trim();

  if (!owner || !name) {
    throw new InputValidationError(
      "repository.owner and repository.name are required.",
    );
  }

  if (
    !Number.isInteger(input.pullRequest.number) ||
    input.pullRequest.number <= 0
  ) {
    throw new InputValidationError(
      "pullRequest.number must be a positive integer.",
    );
  }

  if (!title || !baseSha || !headSha) {
    throw new InputValidationError(
      "pullRequest.title, pullRequest.baseSha, and pullRequest.headSha are required.",
    );
  }

  const files = normalizeFiles(input.files);
  const config = normalizeConfig(input.config);

  return {
    ...input,
    repository: {
      ...input.repository,
      owner,
      name,
    },
    pullRequest: {
      ...input.pullRequest,
      title,
      baseSha,
      headSha,
    },
    files,
    config,
  };
}
