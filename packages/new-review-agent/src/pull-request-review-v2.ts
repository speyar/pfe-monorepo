import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgentV2 } from "./review-agent-v2";

export type PullRequestReviewVerdict =
  | "approve"
  | "comment"
  | "request_changes";

export interface PullRequestReviewFindingV2 {
  severity: "critical" | "high" | "medium" | "low" | "info";
  file: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
  skill?: string;
}

export interface PullRequestReviewSummaryV2 {
  verdict: PullRequestReviewVerdict;
  score: number;
  overview: string;
  risk: string;
  model?: string;
  elapsedMs?: number;
}

export interface PullRequestReviewResultV2 {
  summary: PullRequestReviewSummaryV2;
  findings: PullRequestReviewFindingV2[];
  notes?: string[];
}

export interface PullRequestReviewInputV2 {
  installationId: number;
  owner: string;
  repo: string;
  headRef: string;
  baseRef?: string;
}

export interface PullRequestReviewOptionsV2 {
  modelName?: string;
  ownerId?: string;
  repositoryUrl?: string;
  maxFindings?: number;
  maxSkillWorkers?: number;
  maxSymbols?: number;
  skillsDir?: string;
  signal?: AbortSignal;
}

function toFindings(
  findings: Awaited<ReturnType<typeof runReviewAgentV2>>["findings"],
): PullRequestReviewFindingV2[] {
  return findings.map((finding) => ({
    severity: finding.severity,
    file: finding.file ?? "unknown",
    line: finding.line,
    quote: finding.quote,
    title: finding.title,
    message: finding.message,
    suggestion: finding.suggestion,
    skill: finding.skill,
  }));
}

function scoreFromFindings(findings: PullRequestReviewFindingV2[]): number {
  const severityPenalty = findings.reduce((sum, finding) => {
    switch (finding.severity) {
      case "critical":
        return sum + 35;
      case "high":
        return sum + 20;
      case "medium":
        return sum + 10;
      case "low":
        return sum + 4;
      default:
        return sum + 1;
    }
  }, 0);

  return Math.max(0, Math.min(100, 100 - severityPenalty));
}

function buildSummary(
  findings: PullRequestReviewFindingV2[],
  modelName: string,
  elapsedMs: number,
): PullRequestReviewSummaryV2 {
  const hasCriticalOrHigh = findings.some(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  );
  const hasMedium = findings.some((finding) => finding.severity === "medium");

  const verdict: PullRequestReviewVerdict =
    findings.length === 0
      ? "approve"
      : hasCriticalOrHigh
        ? "request_changes"
        : "comment";
  const risk = hasCriticalOrHigh ? "high" : hasMedium ? "medium" : "low";
  const score = scoreFromFindings(findings);

  return {
    verdict,
    score,
    overview:
      findings.length === 0
        ? "No blocking findings detected in this pull request."
        : `Detected ${findings.length} finding${findings.length === 1 ? "" : "s"} that should be reviewed before merge.`,
    risk,
    model: modelName,
    elapsedMs,
  };
}

export async function runPullRequestReviewV2(
  input: PullRequestReviewInputV2,
  options: PullRequestReviewOptionsV2 = {},
): Promise<PullRequestReviewResultV2> {
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
  if (!copilotToken) {
    throw new Error("Missing COPILOT_GITHUB_TOKEN");
  }

  const modelName =
    options.modelName ?? process.env.REVIEW_MODEL ?? "gpt-5.4-mini";
  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
    name: "copilot",
  });

  const githubClient = await getGitHubClient(input.installationId);
  const {
    data: { token },
  } = await githubClient.rest.apps.createInstallationAccessToken({
    installation_id: input.installationId,
  });

  const manager = SandboxManager.getInstance({
    provider: new VercelSandboxProvider(),
    logger: console,
  });

  const sandbox = await manager.createSandbox({
    ownerId: options.ownerId ?? "review-agent-v2",
    source: {
      type: "git",
      url:
        options.repositoryUrl ??
        `https://github.com/${input.owner}/${input.repo}.git`,
      username: "x-access-token",
      password: token,
    },
  });

  const startedAt = Date.now();

  try {
    const review = await runReviewAgentV2(input.headRef, {
      model: provider(modelName),
      sandboxManager: manager,
      sandboxId: sandbox.id,
      defaultBranch: input.baseRef,
      maxFindings: options.maxFindings ?? 25,
      maxSkillWorkers: options.maxSkillWorkers ?? 3,
      maxSymbols: options.maxSymbols ?? 50,
      skillsDir: options.skillsDir,
      signal: options.signal,
    });

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;
    const summary = buildSummary(findings, modelName, elapsedMs);

    return {
      summary,
      findings,
      notes: [
        `engine=v2`,
        `skills=${review.meta.selectedSkills.join(",") || "none"}`,
        `dependency_tags=${review.meta.dependencyTags.join(",") || "none"}`,
      ],
    };
  } catch (error) {
    return {
      summary: {
        verdict: "comment",
        score: 0,
        overview: "An error occurred during the review process.",
        risk: "unknown",
        model: modelName,
        elapsedMs: Date.now() - startedAt,
      },
      findings: [],
      notes: [
        "The review agent v2 encountered an error and could not complete the review.",
        `Error details: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}
