import { generateObject } from "ai";
import { z } from "zod";
import type { SandboxManager } from "@packages/sandbox";
import { createGrepExecutor } from "../tools/GrepTool/execution";
import { createReadFileExecutor } from "../tools/ReadFileTool/execution";
import { debug } from "./debug";
import { textPreview } from "./utils";
import type {
  ReviewWorkerReport,
  ReviewWorkerTask,
  V2ReviewFinding,
} from "./types";

const findingSchema = z.object({
  category: z.enum(["production_break", "code_quality_break"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  quote: z.string().min(1),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(3000),
  impact: z.string().min(1).max(800).optional(),
  suggestion: z.string().optional(),
});

const outputSchema = z.object({
  findings: z.array(findingSchema),
});

function toEvidenceBlock(items: string[]): string {
  if (items.length === 0) {
    return "No evidence collected.";
  }
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n\n");
}

function buildPrompt(input: {
  task: ReviewWorkerTask;
  evidence: string[];
  maxFindings: number;
}): string {
  const checks =
    input.task.crossFileChecks.length === 0
      ? "none"
      : input.task.crossFileChecks
          .map((check) => `${check.symbol} -> ${check.relatedFiles.join(", ")}`)
          .join("\n");

  const ranges = input.task.focusRanges
    .map(
      (range) =>
        `${range.file}:${range.startLine}-${range.endLine} (${range.reason})`,
    )
    .join("\n");

  return [
    `Task ID: ${input.task.id}`,
    `Goal: ${input.task.goal}`,
    `Changed file: ${input.task.changedFile}`,
    `Target files: ${input.task.targetFiles.join(", ")}`,
    `Risk tags: ${input.task.riskTags.join(", ") || "none"}`,
    "",
    "Patch excerpt:",
    textPreview(input.task.patch, 6000),
    "",
    "Cross-file checks:",
    checks,
    "",
    "Focus ranges:",
    ranges || "none",
    "",
    "Evidence:",
    toEvidenceBlock(input.evidence),
    "",
    "Rules:",
    "- ONLY report two categories: production_break or code_quality_break.",
    "- production_break means realistic runtime or behavior break in production.",
    "- code_quality_break means maintainability/reliability degradation with concrete engineering impact.",
    "- Do NOT report type-only import changes unless runtime behavior changes.",
    "- Do NOT report speculative concurrency/race issues without a concrete failing interleaving and exact affected state.",
    "- If you are not highly confident, return no finding.",
    "- Do NOT report low-severity nits or formatting-only issues.",
    "- Prefer high/medium severity only unless the issue is concrete and recurring.",
    "- Do NOT report versioning/export policy advice unless a concrete runtime break is shown.",
    "- Reject philosophy, style preference, and speculative concerns.",
    "- Every finding must include file and line if present in evidence.",
    "- Every finding MUST include quote copied exactly from the target line.",
    "- Every finding must include an impact string describing why this matters.",
    "- Focus on changed file and direct cross-file impacts only.",
    "- Avoid style or generic comments.",
    "- Use the smallest number of findings that cover real breakages.",
    `- Return at most ${input.maxFindings} findings.`,
  ].join("\n");
}

function parseFirstHitLine(grepOutput: string): number | null {
  const firstLine = grepOutput
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("Error:"));
  if (!firstLine) {
    return null;
  }

  const parts = firstLine.split(":");
  if (parts.length < 2) {
    return null;
  }
  const lineValue = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(lineValue)) {
    return null;
  }
  return lineValue;
}

function deriveSearchPath(changedFile: string): string {
  const normalized = changedFile.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return ".";
}

function shouldSkipHeuristicFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("/test") || normalized.endsWith("/test.ts");
}

export async function runTaskWorker(input: {
  model: Parameters<typeof generateObject>[0]["model"];
  sandboxManager: SandboxManager;
  sandboxId: string;
  task: ReviewWorkerTask;
  signal?: AbortSignal;
  maxFindingsPerTask: number;
}): Promise<ReviewWorkerReport> {
  const read = createReadFileExecutor(input.sandboxManager, input.sandboxId);
  const grep = createGrepExecutor(input.sandboxManager, input.sandboxId);

  const evidence: string[] = [];
  const errors: string[] = [];
  const inspected = new Set<string>();
  const searchPath = deriveSearchPath(input.task.changedFile);

  try {
    for (const range of input.task.focusRanges.slice(0, 6)) {
      const changedRead = await read({
        path: range.file,
        lineStart: range.startLine,
        lineEnd: range.endLine,
      });
      if (changedRead.startsWith("Error:")) {
        errors.push(changedRead);
      } else {
        evidence.push(
          `[read:${range.file}:${range.startLine}-${range.endLine}]\n${textPreview(changedRead, 1800)}`,
        );
        inspected.add(range.file);
      }
    }

    for (const check of input.task.crossFileChecks.slice(0, 4)) {
      const grepOut = await grep({
        query: check.symbol,
        path: searchPath,
        options: "--line-number -w",
        maxResults: 30,
      });
      if (grepOut.startsWith("Error:")) {
        errors.push(grepOut);
      } else {
        evidence.push(`[grep:${check.symbol}]\n${textPreview(grepOut, 1200)}`);
      }
    }

    for (const file of input.task.targetFiles.slice(0, 6)) {
      if (file === input.task.changedFile) {
        continue;
      }
      if (shouldSkipHeuristicFile(file)) {
        continue;
      }
      const linkedCheck = input.task.crossFileChecks.find((check) =>
        check.relatedFiles.includes(file),
      );
      if (!linkedCheck) {
        continue;
      }

      const hitOutput = await grep({
        query: linkedCheck.symbol,
        path: file,
        options: "--line-number -w",
        maxResults: 5,
      });
      if (hitOutput.startsWith("Error:") || hitOutput === "No matches found.") {
        continue;
      }

      const hitLine = parseFirstHitLine(hitOutput);
      const lineStart = hitLine ? Math.max(1, hitLine - 20) : 1;
      const lineEnd = hitLine ? hitLine + 20 : 160;
      const readOut = await read({
        path: file,
        lineStart,
        lineEnd,
      });
      if (readOut.startsWith("Error:")) {
        errors.push(readOut);
      } else {
        evidence.push(
          `[read:${file}:${lineStart}-${lineEnd}]\n${textPreview(readOut, 1200)}`,
        );
        inspected.add(file);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const prompt = buildPrompt({
    task: input.task,
    evidence,
    maxFindings: input.maxFindingsPerTask,
  });

  const system = [
    "You are a focused PR review worker.",
    "Return strict JSON only.",
    "Do not add markdown or prose outside schema.",
  ].join(" ");

  try {
    const generation = await generateObject({
      model: input.model,
      system,
      prompt,
      schema: outputSchema,
      abortSignal: input.signal,
    });

    const findings: V2ReviewFinding[] = generation.object.findings.map(
      (item) => ({
        category: item.category,
        impact: item.impact,
        severity: item.severity,
        file: item.file,
        line: item.line,
        quote: item.quote,
        title: item.title,
        message: item.message,
        suggestion: item.suggestion,
        skill: input.task.id,
      }),
    );

    return {
      taskId: input.task.id,
      findings,
      inspectedFiles: Array.from(inspected),
      evidenceItems: evidence.length,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debug("task-worker-failed", {
      taskId: input.task.id,
      error: message,
    });
    return {
      taskId: input.task.id,
      findings: [],
      inspectedFiles: Array.from(inspected),
      evidenceItems: evidence.length,
      errors: [...errors, message],
    };
  }
}
