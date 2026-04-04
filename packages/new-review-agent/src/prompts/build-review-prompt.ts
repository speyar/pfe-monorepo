export interface BuildReviewPromptInput {
  branchName: string;
  workingDir: string;
  defaultBranch: string;
  activeBranch: string;
  changedFiles: string[];
  initialDiff?: string;
  evidence?: string;
  useTools: boolean;
  maxModelRequests: number;
  minExplorationSteps?: number;
}

export function buildReviewPrompt(input: BuildReviewPromptInput): string {
  const evidenceSection = (input.evidence ?? "").trim();
  const diffSection = (input.initialDiff ?? "").trim();
  const minExplorationSteps = input.minExplorationSteps ?? 4;

  return [
    `Branch: ${input.branchName}`,
    `Working directory: ${input.workingDir}`,
    `Default branch: ${input.defaultBranch}`,
    `Active branch: ${input.activeBranch}`,
    "",
    `Changed files (${input.changedFiles.length}):`,
    input.changedFiles.join("\n") || "(none)",
    "",
    ...(diffSection
      ? ["Precomputed diff (already provided by runtime):", diffSection, ""]
      : []),
    ...(evidenceSection
      ? [
          "Precomputed repository evidence (already provided by runtime):",
          evidenceSection,
          "",
        ]
      : []),
    "TASK:",
    "- Find real semantic issues and inconsistencies using diff context and focused tool usage.",
    `- Perform active exploration: use tools over at least ${minExplorationSteps} tool-using steps before finalizing.`,
    "- Start by calling git diff for the full range between default branch and HEAD, then inspect impacted symbols with grep/glob, then read relevant files.",
    "- For code discovery and caller tracing, prefer grep first; use readFile only after grep points you to exact files/lines.",
    "- Do not read whole files unless absolutely required; pass lineStart/lineEnd or maxLines to keep reads focused.",
    "- Prioritize high-impact regressions over style nits.",
    "- Avoid speculative findings when evidence is weak.",
    input.useTools
      ? `- Tools are available but expensive. Use minimal calls and finish within ${input.maxModelRequests} model requests.`
      : "- Do not call tools; use provided evidence only.",
    "",
    "OUTPUT:",
    "- Return ONLY valid JSON object: { findings: [...] }",
    "- Each finding MUST include: severity, title, message; file/line/quote when available.",
    "- Severity must be one of: critical | high | medium | low | info.",
    "- If no issues found, return: { findings: [] }",
    "- No markdown fences.",
  ].join("\n\n");
}
