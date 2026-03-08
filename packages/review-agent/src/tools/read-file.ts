import type { ReviewRequestFile } from "../contracts/review-request";

export function readFileFromReviewInput(
  files: readonly ReviewRequestFile[],
  path: string,
): ReviewRequestFile | null {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return null;
  }

  return files.find((file) => file.path === normalizedPath) ?? null;
}
import type { ReviewRequestFile } from "../contracts/review-request";

export function readFileFromReviewInput(
  files: readonly ReviewRequestFile[],
  path: string,
): ReviewRequestFile | null {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return null;
  }

  return files.find((file) => file.path === normalizedPath) ?? null;
}
import type { ReviewRequestFile } from "../contracts/review-request";

export function readFileFromReviewInput(
  files: readonly ReviewRequestFile[],
  path: string,
): ReviewRequestFile | null {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return null;
  }

  return files.find((file) => file.path === normalizedPath) ?? null;
}
