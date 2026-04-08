import { normalizePath, runCommand } from "./utils";
import type {
  ParentRejectedFinding,
  ReviewWorkerReport,
  V2ReviewFinding,
} from "./types";

function normalizeMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fingerprint(item: V2ReviewFinding): string {
  return [
    normalizePath(item.file ?? ""),
    item.line ?? 0,
    item.title.trim().toLowerCase(),
    normalizeMessage(item.message),
  ].join("|");
}

function parseNewSideHunkRanges(
  patch: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
  let match = regex.exec(patch);
  while (match) {
    const start = Number.parseInt(match[3] ?? "1", 10);
    const count = Number.parseInt(match[4] ?? "1", 10);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 1;
    ranges.push({
      start,
      end: Math.max(start, start + safeCount - 1),
    });
    match = regex.exec(patch);
  }
  return ranges;
}

function isLineInsidePatchHunk(patch: string, line: number): boolean {
  const ranges = parseNewSideHunkRanges(patch);
  if (ranges.length === 0) {
    return false;
  }
  return ranges.some((range) => line >= range.start && line <= range.end);
}

async function validateFileLine(input: {
  sandboxManager: Parameters<typeof runCommand>[0];
  sandboxId: string;
  finding: V2ReviewFinding;
  patch?: string;
}): Promise<{ ok: boolean; reason?: string; lineContent?: string }> {
  if (!input.finding.file) {
    return { ok: false, reason: "missing-file" };
  }
  if (!input.finding.line || input.finding.line < 1) {
    return { ok: false, reason: "missing-line" };
  }

  if (input.patch && !isLineInsidePatchHunk(input.patch, input.finding.line)) {
    return { ok: false, reason: "line-not-in-patch-hunks" };
  }

  const result = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "sed",
    ["-n", `${input.finding.line},${input.finding.line}p`, input.finding.file],
  );
  if (result.exitCode !== 0) {
    return { ok: false, reason: "file-line-unreadable" };
  }
  const readOut = result.stdout;

  if (!input.finding.quote || input.finding.quote.trim().length === 0) {
    return { ok: false, reason: "missing-quote" };
  }

  if (input.finding.quote) {
    const normalizedQuote = input.finding.quote.trim();
    if (normalizedQuote.length > 0 && !readOut.includes(normalizedQuote)) {
      return { ok: false, reason: "quote-mismatch" };
    }
  }

  return { ok: true, lineContent: readOut.trim() };
}

function hasConcreteImpact(finding: V2ReviewFinding): boolean {
  const impact = finding.impact?.trim() ?? "";
  if (impact.length < 12) {
    return false;
  }

  const lower = impact.toLowerCase();
  const weak = [
    "might",
    "could maybe",
    "possibly",
    "philosophy",
    "style preference",
    "nit",
  ];
  if (weak.some((token) => lower.includes(token))) {
    return false;
  }

  return true;
}

function isLikelyNonActionable(finding: V2ReviewFinding): boolean {
  const content = `${finding.title} ${finding.message} ${finding.impact ?? ""}`
    .toLowerCase()
    .trim();
  const weakSignals = [
    "type-only",
    "might",
    "could",
    "possibly",
    "future refactor",
    "style",
    "preference",
    "theoretical",
    "in edge cases",
  ];

  return weakSignals.some((token) => content.includes(token));
}

function isTypeOnlyQuote(finding: V2ReviewFinding): boolean {
  const quote = finding.quote?.trim().toLowerCase() ?? "";
  if (!quote) {
    return false;
  }
  return quote.startsWith("import type ") || quote.startsWith("export type ");
}

function isLikelyFalsePositivePattern(finding: V2ReviewFinding): boolean {
  const file = (finding.file ?? "").toLowerCase();
  const text = `${finding.title} ${finding.message} ${finding.impact ?? ""}`
    .toLowerCase()
    .trim();

  if (
    file.endsWith("parallel-scheduler.ts") &&
    (text.includes("atomic") ||
      text.includes("interleaving") ||
      text.includes("race"))
  ) {
    return true;
  }

  return false;
}

function isPolicyOnlyFinding(finding: V2ReviewFinding): boolean {
  const text = `${finding.title} ${finding.message} ${finding.impact ?? ""}`
    .toLowerCase()
    .trim();

  const policySignals = [
    "migration guidance",
    "major-version",
    "major version",
    "public api",
    "entrypoint",
    "versioning",
    "compatibility guard",
  ];

  return policySignals.some((token) => text.includes(token));
}

function isExplicitlyWeakSeverity(finding: V2ReviewFinding): boolean {
  if (finding.severity !== "low" && finding.severity !== "info") {
    return false;
  }
  const text = `${finding.title} ${finding.message} ${finding.impact ?? ""}`
    .toLowerCase()
    .trim();
  const weak = [
    "formatter",
    "formatting",
    "indent",
    "style",
    "nit",
    "no runtime behavior",
  ];
  return weak.some((token) => text.includes(token));
}

function isTypeImportSpecifierLine(lineContent?: string): boolean {
  if (!lineContent) {
    return false;
  }
  const line = lineContent.trim();
  if (!line) {
    return false;
  }
  return (
    line.startsWith("type ") && (line.endsWith(",") || line.includes(" as "))
  );
}

export async function validateWorkerReports(input: {
  sandboxManager: Parameters<typeof runCommand>[0];
  sandboxId: string;
  reports: ReviewWorkerReport[];
  maxFindings: number;
  patchesByFile?: Map<string, string>;
}): Promise<{
  accepted: V2ReviewFinding[];
  rejected: ParentRejectedFinding[];
}> {
  const accepted: V2ReviewFinding[] = [];
  const rejected: ParentRejectedFinding[] = [];
  const seen = new Set<string>();

  for (const report of input.reports) {
    for (const finding of report.findings) {
      const title = finding.title.trim();
      const message = finding.message.trim();
      if (!title || !message) {
        rejected.push({
          finding,
          reason: "empty-title-or-message",
          taskId: report.taskId,
        });
        continue;
      }

      if (
        finding.category !== "production_break" &&
        finding.category !== "code_quality_break"
      ) {
        rejected.push({
          finding,
          reason: "invalid-category",
          taskId: report.taskId,
        });
        continue;
      }

      if (!hasConcreteImpact(finding)) {
        rejected.push({
          finding,
          reason: "missing-or-weak-impact",
          taskId: report.taskId,
        });
        continue;
      }

      if (isLikelyNonActionable(finding)) {
        rejected.push({
          finding,
          reason: "non-actionable-or-speculative",
          taskId: report.taskId,
        });
        continue;
      }

      if (isTypeOnlyQuote(finding)) {
        rejected.push({
          finding,
          reason: "type-only-change",
          taskId: report.taskId,
        });
        continue;
      }

      if (isLikelyFalsePositivePattern(finding)) {
        rejected.push({
          finding,
          reason: "known-false-positive-pattern",
          taskId: report.taskId,
        });
        continue;
      }

      if (isPolicyOnlyFinding(finding)) {
        rejected.push({
          finding,
          reason: "policy-only-finding",
          taskId: report.taskId,
        });
        continue;
      }

      if (isExplicitlyWeakSeverity(finding)) {
        rejected.push({
          finding,
          reason: "weak-low-severity-finding",
          taskId: report.taskId,
        });
        continue;
      }

      const fileLineValidation = await validateFileLine({
        sandboxManager: input.sandboxManager,
        sandboxId: input.sandboxId,
        finding,
        patch: input.patchesByFile?.get(normalizePath(finding.file ?? "")),
      });
      if (!fileLineValidation.ok) {
        rejected.push({
          finding,
          reason: fileLineValidation.reason ?? "invalid-anchor",
          taskId: report.taskId,
        });
        continue;
      }

      if (isTypeImportSpecifierLine(fileLineValidation.lineContent)) {
        rejected.push({
          finding,
          reason: "type-import-specifier-line",
          taskId: report.taskId,
        });
        continue;
      }

      const key = fingerprint(finding);
      if (seen.has(key)) {
        rejected.push({
          finding,
          reason: "duplicate-fingerprint",
          taskId: report.taskId,
        });
        continue;
      }
      seen.add(key);

      accepted.push({
        ...finding,
        title,
        message,
      });
      if (accepted.length >= Math.max(1, input.maxFindings)) {
        return { accepted, rejected };
      }
    }
  }

  return { accepted, rejected };
}
