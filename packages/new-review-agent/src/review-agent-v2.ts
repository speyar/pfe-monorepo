import { prepareBranchContext } from "./v2/branch-context";
import { collectPatchesByFile } from "./v2/diff-context";
import { debug } from "./v2/debug";
import { runWithConcurrency } from "./v2/parallel-scheduler";
import { buildReviewPlan } from "./v2/orchestration-planner";
import { runTaskWorker } from "./v2/task-worker";
import { validateWorkerReports } from "./v2/parent-validator";
import { ensureRipgrepAvailable } from "./v2/sandbox-search";
import type { ReviewAgentV2Options, ReviewAgentV2Result } from "./v2/types";

export async function runReviewAgentV2(
  branchName: string,
  options: ReviewAgentV2Options,
): Promise<ReviewAgentV2Result> {
  const maxFindings = Math.max(1, options.maxFindings ?? 25);
  const maxWorkers = Math.max(1, Math.min(options.maxSkillWorkers ?? 3, 4));

  const branch = await prepareBranchContext({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    branchName,
    defaultBranch: options.defaultBranch,
  });
  debug("branch", {
    defaultBranch: branch.defaultBranch,
    activeBranch: branch.activeBranch,
    changedFiles: branch.changedFiles.slice(0, 20),
  });

  if (branch.changedFiles.length === 0) {
    return {
      findings: [],
      meta: {
        version: "v2",
        selectedSkills: [],
        dependencyTags: [],
        changedFiles: 0,
        planTasksCount: 0,
        crossFileChecksCount: 0,
        validatedFindingsCount: 0,
        parentRejectedFindingsCount: 0,
        partialCoverage: false,
      },
    };
  }

  const patchCollection = await collectPatchesByFile({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    defaultBranch: branch.defaultBranch,
    changedFiles: branch.changedFiles,
  });

  const rgSetup = await ensureRipgrepAvailable({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
  });

  const plan = await buildReviewPlan({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    changedFiles: branch.changedFiles,
    patchesByFile: patchCollection.patchesByFile,
    maxTasks: Math.min(10, branch.changedFiles.length),
  });

  const crossFileChecksCount = plan.tasks.reduce(
    (sum, task) => sum + task.crossFileChecks.length,
    0,
  );

  debug("plan", {
    tasks: plan.tasks.length,
    crossFileChecksCount,
    riskTags: plan.riskTags,
    partialCoverage: plan.partialCoverage,
    ripgrep: rgSetup,
  });

  const reports = await runWithConcurrency(plan.tasks, maxWorkers, (task) =>
    runTaskWorker({
      model: options.model,
      sandboxManager: options.sandboxManager,
      sandboxId: options.sandboxId,
      task,
      signal: options.signal,
      maxFindingsPerTask: Math.max(
        2,
        Math.ceil(maxFindings / Math.max(1, plan.tasks.length)),
      ),
    }),
  );

  const workerErrorsCount = reports.reduce(
    (sum, report) => sum + report.errors.length,
    0,
  );

  const validated = await validateWorkerReports({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    reports,
    maxFindings,
    patchesByFile: patchCollection.patchesByFile,
  });

  const rejectedReasonCounts = validated.rejected.reduce(
    (acc, item) => {
      const key = item.reason || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    findings: validated.accepted,
    meta: {
      version: "v2",
      selectedSkills: plan.tasks.map((task) => task.id),
      dependencyTags: plan.riskTags,
      changedFiles: branch.changedFiles.length,
      diffFailureCount: patchCollection.failures.length,
      workerErrorsCount,
      workerFindingsCount: reports.reduce(
        (sum, report) => sum + report.findings.length,
        0,
      ),
      evidenceCount: reports.reduce(
        (sum, report) => sum + report.evidenceItems,
        0,
      ),
      rejectedFindingsCount: validated.rejected.length,
      planTasksCount: plan.tasks.length,
      crossFileChecksCount,
      validatedFindingsCount: validated.accepted.length,
      parentRejectedFindingsCount: validated.rejected.length,
      rejectedReasonCounts,
      partialCoverage: plan.partialCoverage,
      skillsDir: `rg:${rgSetup.method}`,
    },
  };
}

export type { ReviewAgentV2Options, ReviewAgentV2Result } from "./v2/types";
