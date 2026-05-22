import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgent, type Skill } from "./review-agent";
import type { DiffSummary } from "./diff-summarize";
import { generateCodebaseGraph } from "./graph-generator";
import type { LanguageModel } from "ai";
import { runSubReviews, mergeSubFindings, buildSubFindingsPrompt } from "./fan-out-review";

export type PullRequestReviewVerdict =
  | "approve"
  | "comment"
  | "request_changes";

export interface PullRequestReviewFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
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
  files?: Array<{ path: string; patch: string }>;
}

export interface PullRequestReviewOptions {
  modelName?: string;
  model?: LanguageModel;
  ownerId?: string;
  repositoryUrl?: string;
  maxFindings?: number;
  maxToolSteps?: number;
  minToolSteps?: number;
  signal?: AbortSignal;
  skills?: Skill[];
  maxFilesBeforeFanOut?: number;
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
  findings: PullRequestReviewFinding[],
  modelName: string,
  elapsedMs: number,
): PullRequestReviewSummary {
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
  const model = options.model ?? (() => {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      const provider = createOpenaiCompatible({
        apiKey: deepseekKey,
        baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://opencode.ai/zen/go/v1",
        name: "deepseek",
      });
      const modelName = process.env.DEEPSEEK_MODEL ?? process.env.REVIEW_MODEL ?? "deepseek-v4-flash";
      console.log(`[provider] using DeepSeek/OpenCodeGO: ${modelName}`);
      return provider(modelName);
    }
    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    if (!copilotToken) {
      throw new Error("Missing COPILOT_GITHUB_TOKEN (and no DEEPSEEK_API_KEY)");
    }
    const provider = createOpenaiCompatible({
      apiKey: copilotToken,
      baseURL: process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
      name: "copilot",
    });
    return provider(process.env.REVIEW_MODEL ?? "gpt-5.4-mini");
  })();

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

    console.log("Generating codebase graph...");
    let effectiveGraphPath: string | undefined = graphPath;
    try {
      const graphResult = await generateCodebaseGraph(manager, sandbox.id, {
        rootPath: workingDir,
        outPath: graphPath,
        pretty: true,
      });
      console.log(
        `Codebase graph generated — packages=${graphResult.packageCount}, files=${graphResult.fileCount}, nodes=${graphResult.nodeCount}, edges=${graphResult.edgeCount}, elapsedMs=${graphResult.elapsedMs}`,
      );
    } catch (graphError) {
      console.warn("[review-agent] Codebase graph generation failed, continuing without it", {
        error: graphError instanceof Error ? graphError.message : String(graphError),
      });
      effectiveGraphPath = undefined;
    }

    const files = input.files ?? [];
    const threshold = options.maxFilesBeforeFanOut ?? 30;

    let subFindingsPrompt = "";

    if (files.length > threshold) {
      console.log(`[review] FAN-OUT MODE: ${files.length} files exceeds threshold of ${threshold}, splitting into batches`);
      const subResults = await runSubReviews({
        model,
        files,
        batchSize: 15,
      });
      const subFindings = mergeSubFindings(subResults);
      subFindingsPrompt = buildSubFindingsPrompt(subFindings);
      console.log(`[review] FAN-OUT DONE: ${subFindings.length} findings from sub-agents → main agent will validate them`);
    } else {
      const modeSource = files.length > 0 ? `${files.length} files` : "initialDiff provided";
      console.log(`[review] SINGLE-AGENT MODE: ${modeSource} (threshold=${threshold})`);
    }

    const initialDiff = input.initialDiff ?? (files.length > 0
      ? files.map((f) => {
          return [
            `diff --git a/${f.path} b/${f.path}`,
            `--- a/${f.path}`,
            `+++ b/${f.path}`,
            f.patch,
          ].join("\n");
        }).join("\n\n")
      : "");

    const review = await runReviewAgent(input.headRef, {
      model,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      initialDiff,
      diffSummary: input.diffSummary,
      defaultBranch: input.baseRef,
      maxFindings: options.maxFindings ?? 20,
      maxToolSteps: options.maxToolSteps ?? 24,
      minToolSteps: options.minToolSteps ?? 5,
      signal: options.signal,
      graphPath: effectiveGraphPath,
      skills: options.skills,
      subFindingsContext: subFindingsPrompt || undefined,
    });

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;
    const modelName = process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

    return {
      summary: buildSummary(findings, modelName, elapsedMs),
      findings,
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
        model: "gpt-5.4-mini",
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
