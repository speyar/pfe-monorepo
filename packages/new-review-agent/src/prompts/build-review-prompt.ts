export interface BuildReviewPromptInput {
  branchName: string;
  workingDir: string;
  defaultBranch: string;
  activeBranch: string;
  changedFiles: string[];
  initialDiff?: string;
}

export function buildReviewPrompt(input: BuildReviewPromptInput): string {
  const diffSection = (input.initialDiff ?? "").trim();

  return [
    `Branch: ${input.branchName}`,
    `Working directory: ${input.workingDir}`,
    `Default branch: ${input.defaultBranch}`,
    `Active branch: ${input.activeBranch}`,
    "",
    `Changed files (${input.changedFiles.length}):`,
    input.changedFiles.join("\n") || "(none)",
    "",
    ...(diffSection ? ["Precomputed diff:", diffSection, ""] : []),
  ].join("\n\n");
}
