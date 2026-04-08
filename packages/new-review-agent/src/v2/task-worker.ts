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
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  quote: z.string().optional(),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(3000),
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
    "Evidence:",
    toEvidenceBlock(input.evidence),
    "",
    "Rules:",
    "- Only report concrete behavioral risks.",
    "- Every finding must include file and line if present in evidence.",
    "- Focus on changed file and direct cross-file impacts only.",
    "- Avoid style or generic comments.",
    `- Return at most ${input.maxFindings} findings.`,
  ].join("\n");
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

  try {
    const changedRead = await read({
      path: input.task.changedFile,
      lineStart: 1,
      maxLines: 220,
    });
    if (changedRead.startsWith("Error:")) {
      errors.push(changedRead);
    } else {
      evidence.push(
        `[read:${input.task.changedFile}]\n${textPreview(changedRead, 1800)}`,
      );
      inspected.add(input.task.changedFile);
    }

    for (const check of input.task.crossFileChecks.slice(0, 4)) {
      const grepOut = await grep({
        query: check.symbol,
        path: ".",
        options: "--fixed-strings --line-number",
        maxResults: 20,
      });
      if (grepOut.startsWith("Error:")) {
        errors.push(grepOut);
      } else {
        evidence.push(`[grep:${check.symbol}]\n${textPreview(grepOut, 1200)}`);
      }
    }

    for (const file of input.task.targetFiles.slice(0, 5)) {
      if (file === input.task.changedFile) {
        continue;
      }
      const readOut = await read({
        path: file,
        lineStart: 1,
        maxLines: 160,
      });
      if (readOut.startsWith("Error:")) {
        errors.push(readOut);
      } else {
        evidence.push(`[read:${file}]\n${textPreview(readOut, 1200)}`);
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
        ...item,
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
