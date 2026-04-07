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
import { runCommand } from "./v2/utils";

const CORE_SKILL_NAME = "core-general-review";

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

async function collectImpactedFiles(input: {
  sandboxManager: ReviewAgentV2Options["sandboxManager"];
  sandboxId: string;
  changedFiles: string[];
  imports: string[];
  symbols: string[];
}): Promise<string[]> {
  const set = new Set<string>(input.changedFiles.map(normalizeRepoPath));

  const importCandidates = input.imports
    .filter((item) => item.startsWith(".") || item.startsWith("/"))
    .slice(0, 60);

  for (const importPath of importCandidates) {
    const grepResult = await runCommand(
      input.sandboxManager,
      input.sandboxId,
      "grep",
      ["-R", "-n", "-F", importPath, "."],
    );

    const lines = (grepResult.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 80);

    for (const line of lines) {
      const file = normalizeRepoPath(line.split(":", 1)[0] ?? "");
      if (file) {
        set.add(file);
      }
    }
  }

  const symbolCandidates = input.symbols
    .filter((symbol) => symbol.length >= 4)
    .slice(0, 30);

  for (const symbol of symbolCandidates) {
    const grepResult = await runCommand(
      input.sandboxManager,
      input.sandboxId,
      "grep",
      ["-R", "-n", "-F", symbol, "."],
    );

    const lines = (grepResult.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 80);

    for (const line of lines) {
      const file = normalizeRepoPath(line.split(":", 1)[0] ?? "");
      if (file) {
        set.add(file);
      }
    }
  }

  return Array.from(set);
}

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

async function assertSkillsDirReady(skillsDir: string): Promise<void> {
  if (!(await isDirReadable(skillsDir))) {
    throw new Error(`Skills directory became unreadable: ${skillsDir}`);
  }
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

  const patchCollection = await collectPatchesByFile({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    defaultBranch: branch.defaultBranch,
    changedFiles: branch.changedFiles,
  });
  const patchesByFile = patchCollection.patchesByFile;
  debug("patches", {
    fileCount: patchesByFile.size,
    failures: patchCollection.failures,
  });

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

  const impactedFiles = await collectImpactedFiles({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    changedFiles: branch.changedFiles,
    imports: dependencyMap.nodes.flatMap((node) => node.imports),
    symbols: dependencyMap.topSymbols,
  });

  debug("impacted-files", {
    count: impactedFiles.length,
    sample: impactedFiles.slice(0, 20),
  });

  const skillsDir = await resolveSkillsDir(options.skillsDir);
  await assertSkillsDirReady(skillsDir);
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
    maxSkills: 8,
  });

  if (routedSkills.length < 6) {
    const selectedNames = new Set(routedSkills.map((item) => item.skill.name));
    const additional = skills
      .filter((skill) => !selectedNames.has(skill.name))
      .slice(0, 6 - routedSkills.length)
      .map((skill) => ({
        skill,
        score: 1,
        reasons: ["coverage-fill"],
        files: impactedFiles.slice(0, 12),
        symbols: dependencyMap.topSymbols.slice(0, 8),
      }));

    routedSkills.push(...additional);
  }

  const qualitySkillName = "review-agent-quality";
  if (
    branch.changedFiles.some((file) => file.includes("new-review-agent")) &&
    !routedSkills.some((item) => item.skill.name === qualitySkillName)
  ) {
    const qualitySkill = skills.find(
      (skill) => skill.name === qualitySkillName,
    );
    if (qualitySkill) {
      routedSkills.unshift({
        skill: qualitySkill,
        score: 50,
        reasons: ["pipeline-self-review"],
        files: branch.changedFiles
          .filter((file) => file.includes("new-review-agent"))
          .slice(0, 10),
        symbols: dependencyMap.topSymbols.slice(0, 10),
      });
    }
  }

  const coreRoutedSkill = {
    skill: {
      name: CORE_SKILL_NAME,
      description:
        "Baseline reviewer pass that is not limited to specialized skills.",
      location: "internal://core-general-review",
      content: [
        "Focus on general high-value regressions even when no specific skill matches.",
        "Look for behavioral breaks, cross-file impact, contract drift, runtime exceptions, and ordering bugs.",
        "Prioritize concrete impact and reproducible scenarios over style commentary.",
      ].join("\n"),
      triggers: {
        tags: [],
        filePatterns: [],
        symbolPatterns: [],
      },
    },
    score: 100,
    reasons: ["core-pass"],
    files: impactedFiles.slice(0, 20),
    symbols: dependencyMap.topSymbols.slice(0, 20),
  };

  const allWorkers = [coreRoutedSkill, ...routedSkills];

  debug("routed-skills", {
    count: routedSkills.length,
    routed: routedSkills.map((r) => ({
      skill: r.skill.name,
      score: r.score,
      files: r.files.length,
      symbols: r.symbols.length,
      reasons: r.reasons,
    })),
    workers: allWorkers.map((worker) => worker.skill.name),
    impactedFilesCount: impactedFiles.length,
  });

  const evidenceStore = await harvestEvidence({
    sandboxManager: options.sandboxManager,
    sandboxId: options.sandboxId,
    dependencyMap,
    routedSkills,
    changedFiles: impactedFiles,
    patchesByFile,
    diffFailures: patchCollection.failures,
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
    allWorkers,
    maxSkillWorkers,
    async (routed) => {
      debug("worker-start", {
        skill: routed.skill.name,
        files: routed.files.length,
        symbols: routed.symbols.length,
      });
      try {
        const result = await runSkillWorker({
          model: options.model,
          skill: routed,
          dependencyMap,
          evidenceStore,
          signal: options.signal,
          maxFindingsPerSkill: Math.max(
            4,
            Math.ceil(maxFindings / Math.max(1, allWorkers.length)),
          ),
        });
        debug("worker-end", {
          skill: routed.skill.name,
          findings: result.length,
          severities: result.map((f) => f.severity),
        });
        return {
          skill: routed.skill.name,
          findings: result,
          error: null as string | null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        debug("worker-crash", {
          skill: routed.skill.name,
          error: message,
        });
        return {
          skill: routed.skill.name,
          findings: [],
          error: message,
        };
      }
    },
  );

  const workerErrorsCount = workerResults.filter((item) => item.error).length;
  const coreFindings = workerResults.find(
    (item) => item.skill === CORE_SKILL_NAME,
  )?.findings.length;
  const skillFindingsCount = workerResults
    .filter((item) => item.skill !== CORE_SKILL_NAME)
    .reduce((sum, item) => sum + item.findings.length, 0);

  const findings = verifyAndDedupeFindings({
    findings: workerResults.flatMap((item) => item.findings),
    maxFindings,
  });

  const workerFindingsCount = workerResults.reduce(
    (sum, item) => sum + item.findings.length,
    0,
  );
  const rejectedFindingsCount = Math.max(
    0,
    workerFindingsCount - findings.length,
  );
  debug("final-findings", {
    count: findings.length,
    rejected: rejectedFindingsCount,
    workerFindingsCount,
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
      skillsDir,
      routedSkillsCount: routedSkills.length,
      evidenceCount: evidenceStore.list().length,
      workerFindingsCount,
      rejectedFindingsCount,
      diffFailureCount: patchCollection.failures.length,
      impactedFilesCount: impactedFiles.length,
      coreFindingsCount: coreFindings,
      skillFindingsCount,
      workerErrorsCount,
    },
  };
}

export type { ReviewAgentV2Options, ReviewAgentV2Result } from "./v2/types";
