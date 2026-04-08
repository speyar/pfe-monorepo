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

function normalizeTitle(value: string): string {
  return value
    .trim()
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .toLowerCase()
    .trim();
}

// Enhanced fingerprint that considers semantic similarity
function fingerprint(item: V2ReviewFinding): string {
  return [
    item.file ?? "",
    item.line ?? 0,
    normalizeTitle(item.title),
    normalizeMessage(item.message),
  ].join("|");
}

// Check if two findings are semantically similar (for enhanced deduplication)
function areFindingsSimilar(a: V2ReviewFinding, b: V2ReviewFinding): boolean {
  // Must be in same file and nearby lines to be considered similar
  if (a.file !== b.file) {
    return false;
  }

  const lineDiff = Math.abs((a.line ?? 0) - (b.line ?? 0));
  if (lineDiff > 5) {
    // Within 5 lines
    return false;
  }

  // Check if titles are similar (simple word overlap)
  const titleWordsA = normalizeTitle(a.title).split(/\s+/).filter(Boolean);
  const titleWordsB = normalizeTitle(b.title).split(/\s+/).filter(Boolean);

  if (titleWordsA.length === 0 || titleWordsB.length === 0) {
    return false;
  }

  const commonWords = titleWordsA.filter((word) => titleWordsB.includes(word));
  const similarity =
    commonWords.length / Math.max(titleWordsA.length, titleWordsB.length);

  // If they share significant title similarity and have similar messages
  if (similarity > 0.5) {
    const msgA = normalizeMessage(a.message);
    const msgB = normalizeMessage(b.message);

    // Simple message similarity check
    const msgWordsA = msgA.split(/\s+/).filter(Boolean);
    const msgWordsB = msgB.split(/\s+/).filter(Boolean);

    if (msgWordsA.length > 0 && msgWordsB.length > 0) {
      const commonMsgWords = msgWordsA.filter((word) =>
        msgWordsB.includes(word),
      );
      const msgSimilarity =
        commonMsgWords.length / Math.max(msgWordsA.length, msgWordsB.length);

      return msgSimilarity > 0.3; // Lower threshold for message similarity
    }
  }

  return false;
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

    // Check for exact duplicates first
    const dedupeKey = fingerprint(finding);
    if (seen.has(dedupeKey)) {
      continue;
    }

    // Check for semantic duplicates with existing findings
    let isSemanticDuplicate = false;
    for (const existing of clean) {
      if (areFindingsSimilar(existing, finding)) {
        isSemanticDuplicate = true;
        break;
      }
    }

    if (isSemanticDuplicate) {
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
