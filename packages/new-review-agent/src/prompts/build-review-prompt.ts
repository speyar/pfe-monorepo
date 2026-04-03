export function buildReviewPrompt(
  branchName: string,
  workingDir: string,
): string {
  return [
    `Branch: ${branchName}`,
    `Working directory: ${workingDir}`,
    "",
    "Run 'git diff main..HEAD' or 'git diff master..HEAD' to see what changed in this branch.",
    "Then explore the changed files and find inconsistencies.",
  ].join("\n\n");
}
