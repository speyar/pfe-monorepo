import type { ReviewRequestFile } from "../types";

export function buildReviewPrompt(
  branchName: string,
  files?: ReviewRequestFile[],
): string {
  if (!files || files.length === 0) {
    return `Branch: ${branchName}\n\nExplore this branch and find any code inconsistencies. Use available tools.`;
  }

  const changedFilesList = files.map((f) => f.path).join(", ");

  const formattedFiles = files
    .map((file) => {
      const header = `### ${file.path}`;
      const status = `status: ${file.status ?? "modified"}`;
      const content = file.patch ?? file.content ?? "";

      return [header, status, content].join("\n");
    })
    .join("\n\n");

  return [
    `Branch: ${branchName}`,
    `Changed files: ${changedFilesList}`,
    "",
    "Changed file patches:",
    formattedFiles,
    "",
    "Explore the codebase to find inconsistencies. Use the available tools.",
  ].join("\n\n");
}
