import type { ReviewRequestFile } from "../contracts/review-request";

export function listChangedFiles(
  files: readonly ReviewRequestFile[],
): string[] {
  const unique = new Set<string>();

  for (const file of files) {
    if (!file.path.trim()) {
      continue;
    }

    unique.add(file.path);
  }

  return [...unique];
}
import type { ReviewRequestFile } from "../contracts/review-request";

export function listChangedFiles(
  files: readonly ReviewRequestFile[],
): string[] {
  const unique = new Set<string>();

  for (const file of files) {
    if (!file.path.trim()) {
      continue;
    }

    unique.add(file.path);
  }

  return [...unique];
}
import type { ReviewRequestFile } from "../contracts/review-request";

export function listChangedFiles(
  files: readonly ReviewRequestFile[],
): string[] {
  const unique = new Set<string>();

  for (const file of files) {
    if (!file.path.trim()) {
      continue;
    }

    unique.add(file.path);
  }

  return [...unique];
}
