import { normalizePath } from "./utils";
import { runCommand } from "./utils";
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

async function validateFileLine(input: {
  sandboxManager: Parameters<typeof runCommand>[0];
  sandboxId: string;
  finding: V2ReviewFinding;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!input.finding.file) {
    return { ok: false, reason: "missing-file" };
  }
  if (!input.finding.line || input.finding.line < 1) {
    return { ok: false, reason: "missing-line" };
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

  if (input.finding.quote) {
    const normalizedQuote = input.finding.quote.trim();
    if (normalizedQuote.length > 0 && !readOut.includes(normalizedQuote)) {
      return { ok: false, reason: "quote-mismatch" };
    }
  }

  return { ok: true };
}

export async function validateWorkerReports(input: {
  sandboxManager: Parameters<typeof runCommand>[0];
  sandboxId: string;
  reports: ReviewWorkerReport[];
  maxFindings: number;
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

      const fileLineValidation = await validateFileLine({
        sandboxManager: input.sandboxManager,
        sandboxId: input.sandboxId,
        finding,
      });
      if (!fileLineValidation.ok) {
        rejected.push({
          finding,
          reason: fileLineValidation.reason ?? "invalid-anchor",
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
