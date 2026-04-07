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
import { debug } from "./v2/debug";
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
  debug("branch", {
    ...branch,
    changedFiles: branch.changedFiles.slice(0, 10),
  });

  if (branch.changedFiles.length === 0) {
    debug("early-return", { reason: "no changed files" });
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
  debug("patches", { fileCount: patchesByFile.size });

  const dependencyMap = await buildDependencyMap({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    branch,
    patchesByFile,
    maxSymbols,
  });
  debug("dependency-map", {
    nodeCount: dependencyMap.nodes.length,
    edgeCount: dependencyMap.edges.length,
    tags: dependencyMap.tags,
    hotFiles: dependencyMap.hotFiles.slice(0, 5),
    topSymbols: dependencyMap.topSymbols.slice(0, 8),
    summary: dependencyMap.summary,
  });

  const skillsDir = await resolveSkillsDir(options.skillsDir);
  const skills = await loadSkills(skillsDir);
  if (skills.length === 0) {
    throw new Error(`No skills found in ${skillsDir}`);
  }
  debug("skills-loaded", {
    count: skills.length,
    names: skills.map((s) => s.name),
  });

  const routedSkills = routeSkills({
    dependencyMap,
    skills,
    maxSkills: 4,
  });
  debug("routed-skills", {
    count: routedSkills.length,
    routed: routedSkills.map((r) => ({
      skill: r.skill.name,
      score: r.score,
      files: r.files.length,
      symbols: r.symbols.length,
      reasons: r.reasons,
    })),
  });

  const evidenceStore = await harvestEvidence({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    dependencyMap,
    routedSkills,
    changedFiles: branch.changedFiles,
  });
  debug("evidence-harvest", {
    totalEvidence: evidenceStore.list().length,
    bySkill: routedSkills
      .map((r) => ({
        skill: r.skill.name,
        count: evidenceStore.listBySkill(r.skill.name).length,
      }))
      .filter((b) => b.count > 0),
  });

  const workerResults = await runWithConcurrency(
    routedSkills,
    maxSkillWorkers,
    async (routed) => {
      debug("worker-start", {
        skill: routed.skill.name,
        files: routed.files.length,
        symbols: routed.symbols.length,
      });
      const result = await runSkillWorker({
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
      debug("worker-end", {
        skill: routed.skill.name,
        findings: result.length,
        severities: result.map((f) => f.severity),
      });
      return result;
    },
  );

  const findings = verifyAndDedupeFindings({
    findings: workerResults.flat(),
    maxFindings,
  });
  debug("final-findings", {
    count: findings.length,
    severities: findings.map((f) => f.severity),
    skills: [...new Set(findings.map((f) => f.skill).filter(Boolean))],
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
