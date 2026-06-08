import { createOpenCodeGoModel } from "@pfe-monorepo/opencode-go-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgent } from "./review-agent";
import type { DiffSummary } from "./diff-summarize";
import { generateCodebaseGraph } from "./graph-generator";
import type { LanguageModel } from "ai";

export type PullRequestReviewVerdict =
  | "approve"
  | "comment"
  | "request_changes";

export interface PullRequestReviewFinding {
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  file: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}

export interface PullRequestReviewSummary {
  verdict: PullRequestReviewVerdict;
  score: number;
  overview: string;
  risk: string;
  model?: string;
  elapsedMs?: number;
}

export interface PullRequestReviewResult {
  summary: PullRequestReviewSummary;
  findings: PullRequestReviewFinding[];
  agentSummaries?: { agentId: string; summary: string }[];
  notes?: string[];
}

export interface PullRequestReviewInput {
  installationId: number;
  owner: string;
  repo: string;
  headRef: string;
  baseRef?: string;
  initialDiff?: string;
  diffSummary?: DiffSummary;
}

export interface PullRequestReviewOptions {
  modelName?: string;
  agentModelNames?: Record<string, string>;
  reasoningEffort?: string;
  ownerId?: string;
  repositoryUrl?: string;
  maxFindings?: number;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
}

function toFindings(
  findings: Awaited<ReturnType<typeof runReviewAgent>>["findings"],
): PullRequestReviewFinding[] {
  return findings.map((finding) => ({
    severity: finding.severity,
    file: finding.file ?? "unknown",
    line: finding.line,
    quote: finding.quote,
    title: finding.title,
    message: finding.message,
    suggestion: finding.suggestion,
  }));
}

function scoreFromFindings(findings: PullRequestReviewFinding[]): number {
  const severityPenalty = findings.reduce((sum, finding) => {
    switch (finding.severity) {
      case "P0":
        return sum + 50;
      case "P1":
        return sum + 25;
      case "P2":
        return sum + 10;
      case "P3":
        return sum + 4;
      default:
        return sum + 1;
    }
  }, 0);

  return Math.max(0, Math.min(100, 100 - severityPenalty));
}

function buildSummary(
  findings: PullRequestReviewFinding[],
  modelName: string,
  elapsedMs: number,
): PullRequestReviewSummary {
  const hasP0OrP1 = findings.some(
    (finding) => finding.severity === "P0" || finding.severity === "P1",
  );
  const hasP2 = findings.some((finding) => finding.severity === "P2");

  const verdict: PullRequestReviewVerdict =
    findings.length === 0
      ? "approve"
      : hasP0OrP1
        ? "request_changes"
        : "comment";

  const risk = hasP0OrP1 ? "high" : hasP2 ? "medium" : "low";
  const score = scoreFromFindings(findings);
  const overview =
    findings.length === 0
      ? "No blocking findings detected in this pull request."
      : `Detected ${findings.length} finding${
          findings.length === 1 ? "" : "s"
        } that should be reviewed before merge.`;

  return {
    verdict,
    score,
    overview,
    risk,
    model: modelName,
    elapsedMs,
  };
}

export async function runPullRequestReview(
  input: PullRequestReviewInput,
  options: PullRequestReviewOptions = {},
): Promise<PullRequestReviewResult> {
  const apiKey = process.env.OPENCODEGO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENCODEGO_API_KEY");
  }

  const modelName =
    options.modelName ?? process.env.OPENCODEGO_MODEL ?? "kimi-k2.6";

  const model = createOpenCodeGoModel(modelName);

  const agentModelOverrides: Record<string, LanguageModel> = {};
  for (const [agentId, mName] of Object.entries(
    options.agentModelNames ?? {},
  )) {
    agentModelOverrides[agentId] = createOpenCodeGoModel(mName);
  }
  if (!agentModelOverrides["orchestrator"]) {
    agentModelOverrides["orchestrator"] = createOpenCodeGoModel("deepseek-v4-flash");
  }

  const providerOptions = {
    "opencode-go": {
      reasoningEffort: options.reasoningEffort ?? "high",
    },
  };

  const githubClient = await getGitHubClient(input.installationId);
  const {
    data: { token },
  } = await githubClient.rest.apps.createInstallationAccessToken({
    installation_id: input.installationId,
  });

  const vercelProvider = new VercelSandboxProvider();
  const manager = SandboxManager.getInstance({
    provider: vercelProvider,
    logger: console,
  });

  const sandbox = await manager.createSandbox({
    ownerId: "test-owner",
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
    const cwdResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
    });
    const workingDir = cwdResult.stdout.trim() || "/home/user";
    const graphPath = `${workingDir}/codebase-graph.json`;
    let resolvedGraphPath: string | undefined;

    console.log("Generating codebase graph...");
    try {
      const graphResult = await generateCodebaseGraph(manager, sandbox.id, {
        rootPath: workingDir,
        outPath: graphPath,
        pretty: true,
      });
      resolvedGraphPath = graphResult.graphPath;
      console.log(
        `Codebase graph generated — packages=${graphResult.packageCount}, files=${graphResult.fileCount}, nodes=${graphResult.nodeCount}, edges=${graphResult.edgeCount}, elapsedMs=${graphResult.elapsedMs}`,
      );
    } catch (error) {
      console.warn(
        "Codebase graph generation failed; continuing without graph context",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const review = await runReviewAgent(input.headRef, {
      model,
      agentModelOverrides,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      initialDiff: input.initialDiff,
      diffSummary: input.diffSummary,
      defaultBranch: input.baseRef,
      maxFindings: options.maxFindings ?? 200,
      maxToolSteps: options.maxToolSteps ?? 24,
      minToolSteps: options.minToolSteps ?? 5,
      signal: options.signal,
      graphPath: resolvedGraphPath,
      providerOptions,
    });

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;

    return {
      summary: buildSummary(findings, modelName, elapsedMs),
      findings,
      agentSummaries: review.agentSummaries,
    };
  } catch (error) {
    console.error("Error during pull request review", {
      error,
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
        "The review agent encountered an error and could not complete the review.",
        `Error details: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    await manager.stopSandbox(sandbox.id);
  }
}
