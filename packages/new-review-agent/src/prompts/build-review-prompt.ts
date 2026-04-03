export function buildReviewPrompt(
  branchName: string,
  workingDir: string,
): string {
  return [
    `Branch: ${branchName}`,
    `Working directory: ${workingDir}`,
    "",
    "MANDATORY WORKFLOW:",
    "1. Run 'git diff main..HEAD' or 'git diff master..HEAD' to get list of changed files",
    "2. For each changed file, use readFile to read the actual code",
    "3. Use grep to find usages of new/changed functions/constants",
    "4. Verify changes don't break existing code",
    "5. Output findings as JSON as you discover them",
    "",
    "Start with the git diff command now.",
  ].join("\n\n");
}
