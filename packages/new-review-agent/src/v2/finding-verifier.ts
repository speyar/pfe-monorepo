import type { V2ReviewFinding } from "./types";

const ORDER: Record<V2ReviewFinding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function normalizeMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fingerprint(item: V2ReviewFinding): string {
  return [
    item.file ?? "",
    item.line ?? 0,
    item.title.trim().toLowerCase(),
    normalizeMessage(item.message),
  ].join("|");
}

export function verifyAndDedupeFindings(input: {
  findings: V2ReviewFinding[];
  maxFindings: number;
}): V2ReviewFinding[] {
  const seen = new Set<string>();
  const clean: V2ReviewFinding[] = [];

  for (const finding of input.findings) {
    const title = finding.title.trim();
    const message = finding.message.trim();

    if (!title || !message) {
      continue;
    }

    const dedupeKey = fingerprint(finding);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    clean.push({
      ...finding,
      title,
      message,
      quote: finding.quote?.trim() || undefined,
      suggestion: finding.suggestion?.trim() || undefined,
    });
  }

  clean.sort((a, b) => {
    const bySeverity = ORDER[b.severity] - ORDER[a.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byFile = (a.file ?? "").localeCompare(b.file ?? "");
    if (byFile !== 0) {
      return byFile;
    }
    return (a.line ?? 0) - (b.line ?? 0);
  });

  return clean.slice(0, Math.max(1, input.maxFindings));
}
