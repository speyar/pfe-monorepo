import type { ReviewRequestFile } from "../contracts/review-request";

export interface SearchCodeInput {
  files: readonly ReviewRequestFile[];
  query: string;
  isRegexp?: boolean;
  maxResults?: number;
}

export interface SearchCodeMatch {
  path: string;
  line: number;
  preview: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchCode(input: SearchCodeInput): SearchCodeMatch[] {
  const maxResults = Math.max(1, input.maxResults ?? 20);
  const trimmedQuery = input.query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const source = input.isRegexp ? trimmedQuery : escapeRegExp(trimmedQuery);
  const matcher = new RegExp(source, "i");
  const matches: SearchCodeMatch[] = [];

  for (const file of input.files) {
    const content = file.content ?? file.patch;
    if (!content) {
      continue;
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (typeof line !== "string") {
        continue;
      }

      if (!matcher.test(line)) {
        continue;
      }

      matches.push({
        path: file.path,
        line: index + 1,
        preview: line.trim(),
      });

      if (matches.length >= maxResults) {
        return matches;
      }
    }
  }

  return matches;
}
