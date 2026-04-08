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

function extractErrorDetails(error: unknown): {
  message: string;
  name?: string;
  status?: number;
  stack?: string;
} {
  if (error instanceof Error) {
    const withStatus = error as Error & { status?: number };
    return {
      message: error.message,
      name: error.name,
      status:
        typeof withStatus.status === "number" ? withStatus.status : undefined,
      stack: error.stack,
    };
  }

  return { message: String(error) };
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
  console.info("[review-agent-v2] review start", {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
    headRef: input.headRef,
    baseRef: input.baseRef,
    modelName,
  });

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
      maxFindings: options.maxFindings ?? 40,
      maxSkillWorkers: options.maxSkillWorkers ?? 5,
      maxSymbols: options.maxSymbols ?? 50,
      skillsDir: options.skillsDir,
      signal: options.signal,
    });

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;
    const summary = buildSummary(findings, modelName, elapsedMs);

    const reviewDiagnostics = {
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      headRef: input.headRef,
      baseRef: input.baseRef,
      findings: findings.length,
      verdict: summary.verdict,
      score: summary.score,
      risk: summary.risk,
      elapsedMs,
      selectedSkills: review.meta.selectedSkills,
      dependencyTags: review.meta.dependencyTags,
      changedFiles: review.meta.changedFiles,
      skillsDir: review.meta.skillsDir,
      routedSkillsCount: review.meta.routedSkillsCount,
      evidenceCount: review.meta.evidenceCount,
      workerFindingsCount: review.meta.workerFindingsCount,
      rejectedFindingsCount: review.meta.rejectedFindingsCount,
      diffFailureCount: review.meta.diffFailureCount,
      impactedFilesCount: review.meta.impactedFilesCount,
      coreFindingsCount: review.meta.coreFindingsCount,
      skillFindingsCount: review.meta.skillFindingsCount,
      workerErrorsCount: review.meta.workerErrorsCount,
    };

    if (findings.length === 0) {
      console.warn(
        "[review-agent-v2] review completed with zero findings",
        reviewDiagnostics,
      );
    } else {
      console.info("[review-agent-v2] review completed", reviewDiagnostics);
    }

    return {
      summary,
      findings,
      notes: [
        `engine=v2`,
        `skills=${review.meta.selectedSkills.join(",") || "none"}`,
        `dependency_tags=${review.meta.dependencyTags.join(",") || "none"}`,
        `changed_files=${review.meta.changedFiles}`,
        `selected_skills_count=${review.meta.selectedSkills.length}`,
        `routed_skills_count=${review.meta.routedSkillsCount ?? 0}`,
        `evidence_count=${review.meta.evidenceCount ?? 0}`,
        `worker_findings_count=${review.meta.workerFindingsCount ?? 0}`,
        `rejected_findings_count=${review.meta.rejectedFindingsCount ?? 0}`,
        `diff_failure_count=${review.meta.diffFailureCount ?? 0}`,
        `impacted_files_count=${review.meta.impactedFilesCount ?? 0}`,
        `core_findings_count=${review.meta.coreFindingsCount ?? 0}`,
        `skill_findings_count=${review.meta.skillFindingsCount ?? 0}`,
        `worker_errors_count=${review.meta.workerErrorsCount ?? 0}`,
        `plan_tasks_count=${review.meta.planTasksCount ?? 0}`,
        `cross_file_checks_count=${review.meta.crossFileChecksCount ?? 0}`,
        `validated_findings_count=${review.meta.validatedFindingsCount ?? 0}`,
        `parent_rejected_findings_count=${review.meta.parentRejectedFindingsCount ?? 0}`,
        `partial_coverage=${review.meta.partialCoverage ? "1" : "0"}`,
        `skills_dir=${review.meta.skillsDir ?? "unknown"}`,
      ],
    };
  } catch (error) {
    const errorDetails = extractErrorDetails(error);
    console.error("[review-agent-v2] review failed", {
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      headRef: input.headRef,
      baseRef: input.baseRef,
      modelName,
      error: errorDetails.message,
      errorName: errorDetails.name,
      errorStatus: errorDetails.status,
      errorStack: errorDetails.stack,
    });

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
        "engine=v2",
        "The review agent v2 encountered an error and could not complete the review.",
        `Error details: ${errorDetails.message}`,
      ],
    };
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}
