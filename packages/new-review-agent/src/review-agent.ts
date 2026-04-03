import { generateText, stepCountIs, type LanguageModel } from "ai";

import { reviewResultSchema } from "./schema/review-result";
import { REVIEW_AGENT_SYSTEM_PROMPT } from "./prompts/review-agent";
import { buildReviewPrompt } from "./prompts/build-review-prompt";
import { createLsTool } from "./tools/LsTool";
import { createGrepTool } from "./tools/GrepTool";
import { createGlobTool } from "./tools/GlobTool";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGitTool } from "./tools/GitTool";
import type { SandboxManager } from "@packages/sandbox";

function isStepDebugEnabled(): boolean {
  return process.env.NEW_REVIEW_AGENT_DEBUG_STEPS === "1";
}

function preview(value: unknown, maxChars = 300): string {
  const asText =
    typeof value === "string" ? value : JSON.stringify(value ?? "", null, 0);
  if (asText.length <= maxChars) {
    return asText;
  }
  return `${asText.slice(0, maxChars)}... [truncated ${asText.length - maxChars} chars]`;
}

export interface ReviewAgentOptions {
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  defaultBranch?: string;
  maxFindings?: number;
}

export interface ReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
}

interface BranchSetupResult {
  defaultBranch: string;
  activeBranch: string;
  changedFilesPreview: string[];
}

function normalizeBranchName(branchName: string): string {
  return branchName.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runCommand(
  sandboxManager: SandboxManager,
  sandboxId: string,
  command: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await sandboxManager.runCommand({
      sandboxId,
      command,
      args,
    });

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      stdout: "",
      stderr: message,
      exitCode: 127,
    };
  }
}

function parseJsonResponse(text: string): ReviewResult {
  const cleaned = text.trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { findings: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return reviewResultSchema.parse(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("[llm] failed to parse review JSON", message);
    return { findings: [] };
  }
}

function capFindings(result: ReviewResult, maxFindings: number): ReviewResult {
  if (!Number.isInteger(maxFindings) || maxFindings < 1) {
    return result;
  }

  if (result.findings.length <= maxFindings) {
    return result;
  }

  return {
    findings: result.findings.slice(0, maxFindings),
  };
}

function isLikelyGeneratedOrLowSignalFile(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.endsWith("bun.lock") ||
    normalized.endsWith("pnpm-lock.yaml") ||
    normalized.endsWith("package-lock.json") ||
    normalized.endsWith("yarn.lock") ||
    normalized.includes("/dist/") ||
    normalized.includes("/build/") ||
    normalized.includes("/coverage/")
  );
}

function prioritizeChangedFiles(files: string[]): string[] {
  const unique = Array.from(new Set(files));
  const highSignal = unique.filter(
    (file) => !isLikelyGeneratedOrLowSignalFile(file),
  );
  const lowSignal = unique.filter((file) =>
    isLikelyGeneratedOrLowSignalFile(file),
  );
  return [...highSignal, ...lowSignal];
}

async function setupBranchAndContext(
  sandboxManager: SandboxManager,
  sandboxId: string,
  branchName: string,
  preferredDefaultBranch?: string,
): Promise<BranchSetupResult> {
  const normalizedBranchName = normalizeBranchName(branchName);

  await runCommand(sandboxManager, sandboxId, "git", ["fetch", "--all"]);

  const branchResult = await runCommand(sandboxManager, sandboxId, "git", [
    "branch",
    "-a",
  ]);

  const branches = branchResult.stdout;
  const preferred = preferredDefaultBranch
    ? normalizeBranchName(preferredDefaultBranch)
    : undefined;

  const defaultBranch =
    preferred && branches.includes(`origin/${preferred}`)
      ? preferred
      : branches.includes("origin/main")
        ? "main"
        : branches.includes("origin/master")
          ? "master"
          : "main";

  await runCommand(sandboxManager, sandboxId, "git", ["switch", defaultBranch]);

  const targetLocalExists =
    splitLines(
      (
        await runCommand(sandboxManager, sandboxId, "git", [
          "branch",
          "--list",
          normalizedBranchName,
        ])
      ).stdout,
    ).length > 0;

  if (targetLocalExists) {
    await runCommand(sandboxManager, sandboxId, "git", [
      "switch",
      normalizedBranchName,
    ]);
  } else {
    await runCommand(sandboxManager, sandboxId, "git", [
      "switch",
      "-c",
      normalizedBranchName,
      "--track",
      `origin/${normalizedBranchName}`,
    ]);
  }

  const activeBranch = (
    await runCommand(sandboxManager, sandboxId, "git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
  ).stdout.trim();

  const changedFiles = (
    await runCommand(sandboxManager, sandboxId, "git", [
      "diff",
      "--name-only",
      `${defaultBranch}...HEAD`,
    ])
  ).stdout;

  const changedFilesPreview = splitLines(changedFiles).slice(0, 20);

  return {
    defaultBranch,
    activeBranch,
    changedFilesPreview,
  };
}

export async function runReviewAgent(
  branchName: string,
  options: ReviewAgentOptions,
): Promise<ReviewResult> {
  const { sandboxManager, sandboxId } = options;

  const cwdResult = await sandboxManager.runCommand({
    sandboxId,
    command: "pwd",
  });
  const workingDir = cwdResult.stdout.trim() || "/home/user";

  const branchContext = await setupBranchAndContext(
    sandboxManager,
    sandboxId,
    branchName,
    options.defaultBranch,
  );

  const changedFilesResult = await runCommand(
    sandboxManager,
    sandboxId,
    "git",
    ["diff", "--name-only", `${branchContext.defaultBranch}...HEAD`],
  );
  const changedFiles = prioritizeChangedFiles(
    splitLines(changedFilesResult.stdout),
  );

  const tools = {
    ls: createLsTool(sandboxManager, sandboxId),
    grep: createGrepTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    git: createGitTool(sandboxManager, sandboxId),
  };
  const maxSteps = options.maxToolSteps ?? 16;
  const minToolSteps = Math.max(
    1,
    Math.min(options.minToolSteps ?? 5, maxSteps),
  );
  let toolStepCount = 0;

  const systemPrompt = `${REVIEW_AGENT_SYSTEM_PROMPT}
  
Current working directory: ${workingDir}
Default branch (base for comparison): ${branchContext.defaultBranch}
Target branch (to review): ${branchContext.activeBranch}

Branch already prepared by runtime:
- Fetched remotes
- Switched to default branch then target branch
- Computed changed files preview

Changed files preview (${branchContext.changedFilesPreview.length}):
${branchContext.changedFilesPreview.join("\n") || "(none)"}

Changed files from git --name-only (${changedFiles.length}):
${changedFiles.join("\n") || "(none)"}

Prioritized changed files (high signal first):
${changedFiles.join("\n") || "(none)"}

IMMEDIATE ACTION REQUIRED:
1. First, call the git tool to fetch complete diff context for ${branchContext.defaultBranch}...HEAD.
2. Use tools to inspect impacted callers/usages.
3. Continue exploration for at least ${minToolSteps} tool-using steps before finalizing JSON.`;

  const generation = await generateText({
    model: options.model,
    system: systemPrompt,
    prompt: buildReviewPrompt({
      branchName,
      workingDir,
      defaultBranch: branchContext.defaultBranch,
      activeBranch: branchContext.activeBranch,
      changedFiles,
      initialDiff: undefined,
      evidence: "",
      useTools: true,
      maxModelRequests: maxSteps,
      minExplorationSteps: minToolSteps,
    }),
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: options.signal,
    onStepFinish: (step) => {
      const toolResults =
        (step as { toolResults?: unknown[] }).toolResults ?? [];
      if (step.toolCalls.length > 0) {
        toolStepCount += 1;
      }
      console.log(
        `[step ${step.stepNumber}] finish=${JSON.stringify(step.finishReason)} toolCalls=${step.toolCalls.length} toolResults=${toolResults.length} toolSteps=${toolStepCount}/${minToolSteps}`,
      );

      if (!isStepDebugEnabled()) {
        return;
      }

      if (step.toolCalls.length > 0) {
        console.log(
          `[step ${step.stepNumber}] toolCalls detail`,
          step.toolCalls.map((call) => ({
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            input: preview(call.input),
          })),
        );
      }

      if (toolResults.length > 0) {
        console.log(
          `[step ${step.stepNumber}] toolResults detail`,
          toolResults.map((result) => preview(result)),
        );
      }

      if (step.text && step.text.trim().length > 0) {
        console.log(`[step ${step.stepNumber}] text`, preview(step.text, 500));
      }
    },
  });

  console.log("[llm] tool-assisted review request completed");

  if (isStepDebugEnabled()) {
    console.log("[llm] final text", preview(generation.text, 1000));
  }

  const parsed = parseJsonResponse(generation.text);
  return capFindings(parsed, options.maxFindings ?? 25);
}
