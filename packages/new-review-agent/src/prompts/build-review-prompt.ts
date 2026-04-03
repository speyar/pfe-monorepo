export function buildReviewPrompt(
  branchName: string,
  workingDir: string,
): string {
  return [
    `Branch: ${branchName}`,
    `Working directory: ${workingDir}`,
    "",
    "Explore this branch and find any code inconsistencies. Use available tools.",
    "Start by listing the root directory to understand the project structure.",
  ].join("\n\n");
}
