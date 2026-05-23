import { createOpenaiCompatible } from "@ceira/better-copilot-provider";
import { getGitHubClient } from "@pfe-monorepo/github-api";
import { SandboxManager, VercelSandboxProvider } from "@packages/sandbox";
import { runReviewAgent, type Skill } from "./review-agent";
import type { DiffSummary } from "./diff-summarize";
import { generateCodebaseGraph } from "./graph-generator";
import type { LanguageModel } from "ai";
import {
  runSubReviews,
  mergeSubFindings,
  buildSubFindingsPrompt,
} from "./fan-out-review";
import { prepareBranchContext } from "./v2/branch-context";
import { buildDependencyMap } from "./v2/dependency-map";
import { collectPatchesByFile } from "./v2/diff-context";
import { runCrossReference } from "./cross-ref-agent";
import type { DependencyMap } from "./v2/types";

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
        apiKey: deepseekKey.trim(),
        baseURL: (
          process.env.DEEPSEEK_BASE_URL ?? "https://opencode.ai/zen/go/v1"
        ).trim(),
        name: "deepseek",
      });
      const modelName = (
        process.env.DEEPSEEK_MODEL ??
        process.env.REVIEW_MODEL ??
        "deepseek-v4-flash"
      ).trim();
      console.log(`[provider] using DeepSeek/OpenCodeGO: ${modelName}`);
      return provider(modelName);
    }
    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    if (!copilotToken) {
      throw new Error(
        "Missing COPILOT_GITHUB_TOKEN (and no DEEPSEEK_API_KEY)",
      );
    }
    const provider = createOpenaiCompatible({
      apiKey: copilotToken,
      baseURL:
        process.env.COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
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
  const notes: string[] = [];

  try {
    const cwdResult = await manager.runCommand({
      sandboxId: sandbox.id,
      command: "pwd",
    });
    const workingDir = cwdResult.stdout.trim() || "/home/user";
    const graphPath = `${workingDir}/codebase-graph.json`;

    let effectiveGraphPath: string | undefined = graphPath;
    let graphFailed = false;

    const elapsedBeforeGraph = Date.now() - startedAt;
    if (elapsedBeforeGraph < 5000) {
      try {
        console.log("[review] Generating codebase graph...");
        const graphPromise = generateCodebaseGraph(manager, sandbox.id, {
          rootPath: workingDir,
          outPath: graphPath,
          pretty: true,
        });

        const timeoutMs = 60_000;
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Graph generation timed out")),
            timeoutMs,
          ),
        );

        const graphResult = await Promise.race([graphPromise, timeout]);
        console.log(
          `[review] Codebase graph generated — packages=${graphResult.packageCount}, files=${graphResult.fileCount}, nodes=${graphResult.nodeCount}, edges=${graphResult.edgeCount}, elapsedMs=${graphResult.elapsedMs}`,
        );
      } catch (graphError) {
        const msg =
          graphError instanceof Error ? graphError.message : String(graphError);
        console.warn(
          `[review] Codebase graph generation failed (${msg}), will fall back to dependency-map`,
        );
        effectiveGraphPath = undefined;
        graphFailed = true;
        notes.push(
          `Codebase graph unavailable: ${msg.slice(0, 200)}. Using patch-level dependency analysis instead.`,
        );
      }
    } else {
      console.log(
        `[review] Skipping graph generation (already spent ${elapsedBeforeGraph}ms on setup)`,
      );
      effectiveGraphPath = undefined;
    }

    const files = input.files ?? [];
    const threshold = options.maxFilesBeforeFanOut ?? 30;

    const hasSubFindings = files.length > threshold;
    const baseStepCap = options.maxToolSteps ?? 24;
    const extendedStepCap = hasSubFindings
      ? Math.max(baseStepCap + 12, 36)
      : baseStepCap;
    const minSteps = Math.max(
      5,
      Math.min(options.minToolSteps ?? 5, extendedStepCap - 5),
    );

    console.log(
      `[review] Step config — maxSteps=${extendedStepCap}, minSteps=${minSteps}, hasSubFindings=${hasSubFindings}, graphOk=${!graphFailed}`,
    );

    let subFindingsPrompt = "";

    if (hasSubFindings) {
      console.log(
        `[review] FAN-OUT MODE: ${files.length} files exceeds threshold of ${threshold}, splitting into batches`,
      );

      let dependencyContext = "";
      let depMap: DependencyMap | undefined;
      let depNodes = undefined;
      let depEdges = undefined;

      if (graphFailed) {
        try {
          console.log("[review] Building v2 dependency map as graph fallback...");
          const branchCtx = await prepareBranchContext({
            sandboxManager: manager,
            sandboxId: sandbox.id,
            branchName: input.headRef,
            defaultBranch: input.baseRef,
          });
          const { patchesByFile } = await collectPatchesByFile({
            sandboxManager: manager,
            sandboxId: sandbox.id,
            defaultBranch: branchCtx.defaultBranch,
            changedFiles: branchCtx.changedFiles,
          });
          depMap = await buildDependencyMap({
            sandboxManager: manager,
            sandboxId: sandbox.id,
            branch: branchCtx,
            patchesByFile,
          });
          depNodes = depMap.nodes;
          depEdges = depMap.edges;
          dependencyContext = [
            "DEPENDENCY MAP (patch-level analysis):",
            ...depMap.summary,
            "",
            "Top symbols: " + depMap.topSymbols.slice(0, 10).join(", "),
            "Hot files: " + depMap.hotFiles.slice(0, 8).join(", "),
          ].join("\n");
          console.log(
            `[review] Dependency map built — ${depMap.nodes.length} nodes, ${depMap.edges.length} edges, tags=${depMap.tags.join(",")}`,
          );
        } catch (depErr) {
          console.warn(
            "[review] Dependency map fallback also failed:",
            depErr instanceof Error ? depErr.message : String(depErr),
          );
        }
      }

      const subResults = await runSubReviews({
        model,
        files,
        batchSize: 15,
        sandboxManager: manager,
        sandboxId: sandbox.id,
        graphPath: effectiveGraphPath,
        dependencyNodes: depNodes,
        dependencyEdges: depEdges,
      });

      const subFindings = mergeSubFindings(subResults);

      let crossRefDedupCount = 0;
      if (subFindings.length >= 3) {
        try {
          console.log(`[review] Running cross-reference pass on ${subFindings.length} sub-agent findings...`);
          const crossRefResult = await runCrossReference({
            model,
            subFindings,
            dependencyMap: depMap,
            totalChangedFiles: files.length,
            totalBatches: subResults.length,
          });

          subFindings.splice(0, subFindings.length, ...crossRefResult.findings);
          crossRefDedupCount = crossRefResult.dedupCount;

          console.log(
            `[review] Cross-ref done: ${crossRefResult.findings.length} findings (${crossRefDedupCount} duplicates removed, ${crossRefResult.missedCount} missed, ${crossRefResult.contradictoryPairs.length} contradictions)`,
          );

          if (crossRefResult.missedCount > 0) {
            notes.push(
              `Cross-reference detected ${crossRefResult.missedCount} potentially missed issues.`,
            );
          }
          if (crossRefResult.contradictoryPairs.length > 0) {
            notes.push(
              `Cross-reference detected ${crossRefResult.contradictoryPairs.length} contradictory finding pairs.`,
            );
          }
        } catch (crossErr) {
          console.warn(
            "[review] Cross-ref pass failed, proceeding with raw sub-findings:",
            crossErr instanceof Error ? crossErr.message : String(crossErr),
          );
        }
      }

      const rawPrompt = buildSubFindingsPrompt(subFindings);

      subFindingsPrompt = dependencyContext
        ? `${dependencyContext}\n\n---\n\n${rawPrompt}`
        : rawPrompt;

      console.log(
        `[review] FAN-OUT DONE: ${subFindings.length} findings from sub-agents → main agent will validate them`,
      );
    } else {
      const modeSource =
        files.length > 0
          ? `${files.length} files`
          : "initialDiff provided";
      console.log(
        `[review] SINGLE-AGENT MODE: ${modeSource} (threshold=${threshold})`,
      );
    }

    const initialDiff =
      input.initialDiff ??
      (files.length > 0
        ? files
            .map((f) => {
              return [
                `diff --git a/${f.path} b/${f.path}`,
                `--- a/${f.path}`,
                `+++ b/${f.path}`,
                f.patch,
              ].join("\n");
            })
            .join("\n\n")
        : "");

    let review = await runReviewAgent(input.headRef, {
      model,
      sandboxManager: manager,
      sandboxId: sandbox.id,
      initialDiff,
      diffSummary: input.diffSummary,
      defaultBranch: input.baseRef,
      maxFindings: options.maxFindings ?? 20,
      maxToolSteps: extendedStepCap,
      minToolSteps: minSteps,
      signal: options.signal,
      graphPath: effectiveGraphPath,
      skills: options.skills,
      subFindingsContext: subFindingsPrompt || undefined,
    });

    if (
      review.findings.length === 0 &&
      hasSubFindings &&
      subFindingsPrompt
    ) {
      console.log(
        "[review] Main agent returned 0 findings with sub-context — running validation re-query...",
      );
      const retryPrompt = [
        subFindingsPrompt,
        "",
        "CRITICAL: You just reviewed and returned 0 findings.",
        "The sub-agents above reported findings. Please explicitly:",
        "1. Validate each sub-agent finding against the codebase (confirm, reject, or adjust severity).",
        "2. Explain why each finding was rejected if you disagree with it.",
        "3. Add any missed findings.",
        "4. Output a JSON with at minimum the validated findings from sub-agents.",
        "",
        "If ALL sub-agent findings were false positives, output them but set severity to 'info' and explain in each message why they were rejected.",
      ].join("\n");

      review = await runReviewAgent(input.headRef, {
        model,
        sandboxManager: manager,
        sandboxId: sandbox.id,
        initialDiff,
        diffSummary: input.diffSummary,
        defaultBranch: input.baseRef,
        maxFindings: options.maxFindings ?? 20,
        maxToolSteps: Math.max(extendedStepCap, 30),
        minToolSteps: Math.max(minSteps + 3, 8),
        signal: options.signal,
        graphPath: effectiveGraphPath,
        skills: options.skills,
        subFindingsContext: retryPrompt,
      });

      if (review.findings.length === 0) {
        console.log(
          "[review] Re-query also returned 0 findings — agent genuinely found no issues to report",
        );
        notes.push(
          "Main agent validated all sub-agent findings and found none that required reporting against the actual codebase.",
        );
      } else {
        console.log(
          `[review] Re-query recovered ${review.findings.length} findings`,
        );
        notes.push(
          `Initial agent pass returned 0 findings; re-query recovered ${review.findings.length} findings.`,
        );
      }
    }

    const findings = toFindings(review.findings);
    const elapsedMs = Date.now() - startedAt;
    const modelName = process.env.REVIEW_MODEL ?? "gpt-5.4-mini";

    return {
      summary: buildSummary(findings, modelName, elapsedMs),
      findings,
      notes: notes.length > 0 ? notes : undefined,
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
