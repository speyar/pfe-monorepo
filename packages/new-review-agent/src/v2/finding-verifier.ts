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

function locationsOverlap(a: V2ReviewFinding, b: V2ReviewFinding): boolean {
  if (!a.file || !b.file) return false;
  if (a.file !== b.file) return false;
  if (a.line == null || b.line == null) return false;
  return Math.abs(a.line - b.line) <= 5;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function areSemanticallySimilar(
  a: V2ReviewFinding,
  b: V2ReviewFinding,
): boolean {
  const titleSim = jaccardSimilarity(a.title, b.title);
  const msgSim = jaccardSimilarity(a.message, b.message);
  return titleSim > 0.7 || msgSim > 0.6 || (titleSim > 0.5 && msgSim > 0.4);
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

    const duplicate = clean.find((existing) => {
      const existingKey = fingerprint(existing);
      if (existingKey === dedupeKey) return true;
      if (
        finding.file &&
        existing.file &&
        finding.file === existing.file &&
        locationsOverlap(finding, existing) &&
        finding.severity === existing.severity
      ) {
        return true;
      }
      if (
        finding.file &&
        existing.file &&
        finding.file === existing.file &&
        areSemanticallySimilar(finding, existing)
      ) {
        return true;
      }
      return false;
    });

    if (duplicate) {
      if (ORDER[finding.severity] > ORDER[duplicate.severity]) {
        duplicate.severity = finding.severity;
      }
      if (finding.message.length > duplicate.message.length) {
        duplicate.message = finding.message;
        duplicate.quote = finding.quote ?? duplicate.quote;
        duplicate.line = finding.line ?? duplicate.line;
        duplicate.suggestion = finding.suggestion ?? duplicate.suggestion;
      }
      continue;
    }

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

export function crossRefDedupe(
  passFindings: V2ReviewFinding[],
  existingFindings: V2ReviewFinding[],
): { merged: V2ReviewFinding[]; dedupCount: number } {
  let dedupCount = 0;
  const merged = [...existingFindings];

  for (const finding of passFindings) {
    const foundDup = merged.find(
      (existing) =>
        (finding.file === existing.file &&
          finding.line === existing.line &&
          finding.severity === existing.severity) ||
        areSemanticallySimilar(finding, existing),
    );

    if (foundDup) {
      dedupCount++;
      if (ORDER[finding.severity] > ORDER[foundDup.severity]) {
        foundDup.severity = finding.severity;
      }
      continue;
    }

    merged.push(finding);
  }

  return { merged, dedupCount };
}
