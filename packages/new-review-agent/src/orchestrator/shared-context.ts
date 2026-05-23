import type { DiffSummary } from "../diff-summarize";

export interface SharedContext {
  branchName: string;
  workingDir: string;
  defaultBranch: string;
  activeBranch: string;
  changedFiles: string[];
  diffSummary?: DiffSummary;
  graphContextInfo: string;
  rawDiff?: string;
}

export interface BuildSharedContextInput {
  branchName: string;
  workingDir: string;
  defaultBranch: string;
  activeBranch: string;
  changedFiles: string[];
  diffSummary?: DiffSummary;
  graphContextInfo: string;
  rawDiff?: string;
}

export function buildSharedContext(
  input: BuildSharedContextInput,
): SharedContext {
  return {
    branchName: input.branchName,
    workingDir: input.workingDir,
    defaultBranch: input.defaultBranch,
    activeBranch: input.activeBranch,
    changedFiles: input.changedFiles,
    diffSummary: input.diffSummary,
    graphContextInfo: input.graphContextInfo,
    rawDiff: input.rawDiff,
  };
}

function formatList(items: string[]): string {
  return items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "- (none)";
}

export function formatDiffSummaryForSubAgent(
  diffSummary?: DiffSummary,
): string {
  if (!diffSummary) {
    return "(none)";
  }

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

export function buildSubAgentSystemPrompt(input: {
  agentPrompt: string;
  sharedContext: SharedContext;
}): string {
  const ctx = input.sharedContext;

  return `${input.agentPrompt}

Current working directory: ${ctx.workingDir}
Default branch (base for comparison): ${ctx.defaultBranch}
Target branch (to review): ${ctx.activeBranch}

Branch already prepared by runtime:
- Fetched remotes
- Switched to target branch
- Computed changed files

Changed files (${ctx.changedFiles.length}):
${ctx.changedFiles.join("\n") || "(none)"}

Diff summary context (advisory, not source of truth):
${formatDiffSummaryForSubAgent(ctx.diffSummary)}

Diff summary usage rules:
- Treat diff summary as orientation only; raw diff via git tool and file reads are authoritative.
- Never copy summary wording as evidence. Validate with diff hunks and file reads.
- If summary conflicts with code or diff, trust the code/diff.
- Prefer concrete code-level suggestions over abstract advice.

PRECOMPUTED DIFF (use as your primary source for what changed):
${
  ctx.rawDiff
    ? ctx.rawDiff.length > 15000
      ? ctx.rawDiff.slice(0, 15000) +
        `\n... [diff truncated at 15000 chars, use git tool for full diff]`
      : ctx.rawDiff
    : "(not available, use git tool to get diff)"
}

IMMEDIATE ACTION REQUIRED:
1. Study the PRECOMPUTED DIFF above to understand what changed.
2. For files relevant to your domain, use the git tool for full detail: "git operation=diff args=${ctx.defaultBranch}..HEAD -- path/to/file"
3. Use the codebaseGraph tool (if available) to discover impacted callers/usages and relevant symbols in changed files.
4. Use readFile only for targeted ranges (lineStart/lineEnd or maxLines) when validating evidence.
5. Use glob, ls, and grep to explore the codebase for cross-file concerns.
6. YOU MUST inspect at least 5 files before finalizing your findings.
${ctx.graphContextInfo}`;
}
