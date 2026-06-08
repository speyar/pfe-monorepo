import type { LanguageModel, Tool } from "ai";
import { generateText, stepCountIs } from "ai";

import { reviewResultSchema } from "./schema/review-result";
import type { OrchestratorResult } from "./schema/review-result";
import type { DiffSummary } from "./diff-summarize";
import type { SandboxManager } from "@packages/sandbox";
import { REVIEW_AGENT_SYSTEM_PROMPT } from "./prompts/review-agent";
import { buildReviewPrompt } from "./prompts/build-review-prompt";
import { createLsTool } from "./tools/LsTool";
import { createGlobTool } from "./tools/GlobTool";
import { createReadFileTool } from "./tools/ReadFileTool";
import { createGrepTool } from "./tools/GrepTool";
import { createGitTool } from "./tools/GitTool";
import { createCodebaseGraphTool } from "./tools/CodebaseGraphTool";
import {
  buildSharedContext,
  type SharedContext,
} from "./orchestrator/shared-context";
import { runSubAgents } from "./orchestrator/sub-agent-runner";
import { runOrchestrator } from "./orchestrator/orchestrator";
import { addUsageTelemetry } from "./telemetry/usage-telemetry";

export interface ReviewAgentOptions {
  model: LanguageModel;
  agentModelOverrides?: Record<string, LanguageModel>;
  sandboxManager: SandboxManager;
  sandboxId: string;
  initialDiff?: string;
  diffSummary?: DiffSummary;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  defaultBranch?: string;
  maxFindings?: number;
  graphPath?: string;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface ReviewFinding {
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface AgentSummaryEntry {
  agentId: string;
  summary: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  agentSummaries?: AgentSummaryEntry[];
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

  await runCommand(sandboxManager, sandboxId, "git", ["switch", branchName]);

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

function createAgentTools(
  sandboxManager: SandboxManager,
  sandboxId: string,
  graphPath?: string,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {
    ls: createLsTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    grep: createGrepTool(sandboxManager, sandboxId),
    git: createGitTool(sandboxManager, sandboxId),
    ...(graphPath
      ? {
          codebaseGraph: createCodebaseGraphTool(
            sandboxManager,
            sandboxId,
            graphPath,
          ),
        }
      : {}),
  };
  return tools;
}

function formatDiffSummaryForSystemPrompt(diffSummary?: DiffSummary): string {
  if (!diffSummary) {
    return "(none)";
  }

  const formatList = (items: string[]): string =>
    items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";

  return [
    `intent: ${diffSummary.intent}`,
    "keyChanges:",
    formatList(diffSummary.keyChanges),
    "riskPoints:",
    formatList(diffSummary.riskPoints),
    "openQuestions:",
    formatList(diffSummary.openQuestions),
    "evidence:",
    formatList(diffSummary.evidence),
  ].join("\n");
}

function parseJsonResponseWithReason(text: string): {
  output: ReviewResult;
  reason: string;
} {
  const cleaned = text.trim();

  if (!cleaned) {
    return { output: { findings: [] }, reason: "empty-text" };
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { output: { findings: [] }, reason: "no-json-object-found" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    try {
      return {
        output: reviewResultSchema.parse(parsed) as ReviewResult,
        reason: "ok",
      };
    } catch (schemaError) {
      const schemaMessage =
        schemaError instanceof Error
          ? schemaError.message
          : String(schemaError);
      return {
        output: { findings: [] },
        reason: `schema-parse-failed:${schemaMessage.split("\n")[0]}`,
      };
    }
  } catch (jsonError) {
    const jsonMessage =
      jsonError instanceof Error ? jsonError.message : String(jsonError);
    return {
      output: { findings: [] },
      reason: `json-parse-failed:${jsonMessage.split("\n")[0]}`,
    };
  }
}

function parseJsonResponse(text: string): ReviewResult {
  return parseJsonResponseWithReason(text).output;
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

async function runSingleAgentFallback(
  branchName: string,
  options: ReviewAgentOptions,
  branchContext: BranchSetupResult,
  changedFiles: string[],
  workingDir: string,
): Promise<ReviewResult> {
  console.log("[review-agent] falling back to single-agent review");

  const { sandboxManager, sandboxId } = options;

  const tools: Record<string, Tool> = {
    ls: createLsTool(sandboxManager, sandboxId),
    glob: createGlobTool(sandboxManager, sandboxId),
    readFile: createReadFileTool(sandboxManager, sandboxId),
    ...(options.graphPath
      ? {
          codebaseGraph: createCodebaseGraphTool(
            sandboxManager,
            sandboxId,
            options.graphPath,
          ),
        }
      : {}),
  };

  const maxSteps = options.maxToolSteps ?? 24;
  const minToolSteps = Math.max(
    1,
    Math.min(options.minToolSteps ?? 5, Math.max(1, maxSteps - 2)),
  );
  const forceFinalizeStep = Math.max(minToolSteps, maxSteps - 2);

  let graphContextInfo = "";
  if (options.graphPath) {
    graphContextInfo = `
CODEBASE GRAPH TOOL AVAILABLE:
A codebaseGraph tool is available with precomputed dependency graph data.

USE THE codebaseGraph TOOL for structural queries instead of grep:
- findCallersOf: find who calls a changed function
- findImpactOf: find all files affected by a change to a file
- findDependenciesOf: find what a function depends on
- findUnusedFunctions: find dead code
- getChangedFileNodes: get all graph nodes inside changed files
- getNodesByName: search for symbols by name
- getCrossPackageDeps: list monorepo boundary crossings
- getNodeDetails: get full details of a specific node

Prefer codebaseGraph over grep for dependency, caller, and impact questions.`;
  }

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

Diff summary context (advisory, not source of truth):
${formatDiffSummaryForSystemPrompt(options.diffSummary)}

Diff summary usage rules:
- Treat diff summary as orientation only; raw precomputed diff and files are authoritative.
- Never copy summary wording as evidence. Validate with diff hunks and file reads.
- If summary conflicts with code or diff, trust the code/diff.
- Prefer concrete code-level suggestions over abstract advice.

IMMEDIATE ACTION REQUIRED:
1. Start from the precomputed diff provided in the user prompt.
2. Use the precomputed codebase graph to discover impacted callers/usages and relevant symbols in changed files.
3. Use readFile only for focused ranges (lineStart/lineEnd or maxLines) when validating evidence.
4. Continue exploration for at least ${minToolSteps} tool-using steps before finalizing JSON.${graphContextInfo}`;

  let toolStepCount = 0;
  let finalText = "";

  const generation = await generateText({
    model: options.model,
    system: systemPrompt,
    prompt: buildReviewPrompt({
      branchName,
      workingDir,
      defaultBranch: branchContext.defaultBranch,
      activeBranch: branchContext.activeBranch,
      changedFiles,
      initialDiff: options.initialDiff,
    }),
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: options.signal,
    providerOptions: options.providerOptions as any,
    prepareStep: ({ stepNumber }) => {
      if (stepNumber >= forceFinalizeStep) {
        return {
          toolChoice: "none",
          activeTools: [],
        };
      }
      return undefined;
    },
    onStepFinish: (step) => {
      if (step.toolCalls.length > 0) {
        toolStepCount += 1;
      }
      if (step.text) {
        finalText = step.text;
      }
    },
  });
  addUsageTelemetry(generation.usage as unknown);

  const text = finalText || generation.text || "";
  const parsed = parseJsonResponseWithReason(text);

  return capFindings(parsed.output, options.maxFindings ?? 200);
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

  const tools = createAgentTools(sandboxManager, sandboxId, options.graphPath);

  const sharedContext: SharedContext = buildSharedContext({
    branchName,
    workingDir,
    defaultBranch: branchContext.defaultBranch,
    activeBranch: branchContext.activeBranch,
    changedFiles,
    diffSummary: options.diffSummary,
    graphContextInfo: "",
    rawDiff: options.initialDiff,
  });

  console.log(
    `[review-agent] launching ${changedFiles.length} changed files across 8 sub-agents`,
  );

  const subAgentResults = await runSubAgents({
    model: options.model,
    agentModelOverrides: options.agentModelOverrides,
    sandboxManager,
    sandboxId,
    sharedContext,
    tools,
    concurrency: 8,
    signal: options.signal,
    providerOptions: options.providerOptions,
  });

  const hasAnyFindings = subAgentResults.some((r) => r.findings.length > 0);

  if (!hasAnyFindings) {
    console.log(
      "[review-agent] all sub-agents returned no findings, falling back to single-agent",
    );
    return runSingleAgentFallback(
      branchName,
      options,
      branchContext,
      changedFiles,
      workingDir,
    );
  }

  const orchestratorResult: OrchestratorResult = await runOrchestrator({
    model: options.agentModelOverrides?.["orchestrator"] ?? options.model,
    results: subAgentResults,
    signal: options.signal,
  });

  const maxFindings = options.maxFindings ?? 200;
  const findings = orchestratorResult.findings.slice(0, maxFindings);

  console.log(
    `[review-agent] orchestrated review complete — ${findings.length} findings after dedup (maxFindings=${maxFindings})`,
  );

  return {
    findings,
    agentSummaries: orchestratorResult.agentSummaries,
  };
}
