export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export function getDiffHunks(patch?: string): DiffHunk[] {
  if (!patch?.trim()) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const match = line.match(HUNK_HEADER_REGEX);
    if (match) {
      if (current) {
        hunks.push(current);
      }

      current = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? "1"),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? "1"),
        lines: [],
      };

      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    hunks.push(current);
  }

  return hunks;
}
