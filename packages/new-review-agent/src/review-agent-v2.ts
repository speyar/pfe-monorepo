import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareBranchContext } from "./v2/branch-context";
import { collectPatchesByFile } from "./v2/diff-context";
import { buildDependencyMap } from "./v2/dependency-map";
import { harvestEvidence } from "./v2/evidence-harvest";
import { verifyAndDedupeFindings } from "./v2/finding-verifier";
import { runWithConcurrency } from "./v2/parallel-scheduler";
import { loadSkills } from "./v2/skill-loader";
import { routeSkills } from "./v2/skill-router";
import { runSkillWorker } from "./v2/skill-worker";
import type { ReviewAgentV2Options, ReviewAgentV2Result } from "./v2/types";

async function isDirReadable(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

async function resolveSkillsDir(custom?: string): Promise<string> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  const candidates = [
    custom,
    path.resolve(currentDir, "../skills"),
    path.resolve(currentDir, "skills"),
    path.resolve(process.cwd(), "packages/new-review-agent/skills"),
    path.resolve(process.cwd(), "skills"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await isDirReadable(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to locate skills directory for review-agent v2.");
}

export async function runReviewAgentV2(
  branchName: string,
  options: ReviewAgentV2Options,
): Promise<ReviewAgentV2Result> {
  const maxFindings = options.maxFindings ?? 25;
  const maxSkillWorkers = Math.max(
    1,
    Math.min(options.maxSkillWorkers ?? 3, 6),
  );
  const maxSymbols = Math.max(20, options.maxSymbols ?? 50);

  const branch = await prepareBranchContext({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    branchName,
    defaultBranch: options.defaultBranch,
  });

  if (branch.changedFiles.length === 0) {
    return {
      findings: [],
      meta: {
        version: "v2",
        selectedSkills: [],
        dependencyTags: [],
        changedFiles: 0,
      },
    };
  }

  const patchesByFile = await collectPatchesByFile({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    defaultBranch: branch.defaultBranch,
    changedFiles: branch.changedFiles,
  });

  const dependencyMap = await buildDependencyMap({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    branch,
    patchesByFile,
    maxSymbols,
  });

  const skillsDir = await resolveSkillsDir(options.skillsDir);
  const skills = await loadSkills(skillsDir);
  if (skills.length === 0) {
    throw new Error(`No skills found in ${skillsDir}`);
  }

  const routedSkills = routeSkills({
    dependencyMap,
    skills,
    maxSkills: 4,
  });

  const evidenceStore = await harvestEvidence({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    dependencyMap,
    routedSkills,
    changedFiles: branch.changedFiles,
  });

  const workerResults = await runWithConcurrency(
    routedSkills,
    maxSkillWorkers,
    async (routed) => {
      return runSkillWorker({
        model: options.model,
        skill: routed,
        dependencyMap,
        evidenceStore,
        signal: options.signal,
        maxFindingsPerSkill: Math.max(
          3,
          Math.ceil(maxFindings / Math.max(1, routedSkills.length)),
        ),
      });
    },
  );

  const findings = verifyAndDedupeFindings({
    findings: workerResults.flat(),
    maxFindings,
  });

  return {
    findings,
    meta: {
      version: "v2",
      selectedSkills: routedSkills.map((item) => item.skill.name),
      dependencyTags: dependencyMap.tags,
      changedFiles: branch.changedFiles.length,
    },
  };
}

export type { ReviewAgentV2Options, ReviewAgentV2Result } from "./v2/types";
