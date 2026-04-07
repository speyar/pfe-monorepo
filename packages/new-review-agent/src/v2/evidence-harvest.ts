import type { SandboxManager } from "@packages/sandbox";
import { createGlobExecutor } from "../tools/GlobTool/execution";
import { createGrepExecutor } from "../tools/GrepTool/execution";
import { createReadFileExecutor } from "../tools/ReadFileTool/execution";
import { EvidenceStore } from "./evidence-store";
import { runWithConcurrency } from "./parallel-scheduler";
import { textPreview } from "./utils";
import type { DiffCollectionFailure } from "./diff-context";
import type { DependencyMap, RoutedSkill } from "./types";

function makeId(source: string, key: string): string {
  return `${source}:${key}`;
}

function looksLikeErrorOutput(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) {
    return false;
  }

  const head = trimmed.slice(0, 300).toLowerCase();
  return (
    head.startsWith("error:") ||
    head.includes("executable file not found") ||
    head.includes("command not found")
  );
}

export async function harvestEvidence(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
  dependencyMap: DependencyMap;
  routedSkills: RoutedSkill[];
  changedFiles: string[];
  patchesByFile: Map<string, string>;
  diffFailures: DiffCollectionFailure[];
}): Promise<EvidenceStore> {
  const store = new EvidenceStore();
  const grep = createGrepExecutor(input.sandboxManager, input.sandboxId);
  const glob = createGlobExecutor(input.sandboxManager, input.sandboxId);
  const read = createReadFileExecutor(input.sandboxManager, input.sandboxId);

  for (const [filePath, patch] of input.patchesByFile.entries()) {
    if (!patch.trim()) {
      continue;
    }

    store.add({
      id: makeId("diff-changed", filePath),
      source: "diff-changed",
      file: filePath,
      text: textPreview(patch, 4_000),
    });
  }

  for (const failure of input.diffFailures) {
    store.add({
      id: makeId("diff-failure", failure.path),
      source: "diff-failure",
      file: failure.path,
      text: `Failed to collect patch for ${failure.path}: ${failure.error}`,
    });
  }

  const symbolQueries = input.dependencyMap.topSymbols.slice(0, 20);
  const symbolResults = await runWithConcurrency(
    symbolQueries,
    6,
    async (symbol) => {
      const output = await grep({
        query: symbol,
        maxResults: 30,
        options: "--fixed-strings --line-number",
      });
      return { symbol, output };
    },
  );

  for (const item of symbolResults) {
    if (looksLikeErrorOutput(item.output)) {
      continue;
    }

    store.add({
      id: makeId("grep-symbol", item.symbol),
      source: "grep-symbol",
      text: textPreview(item.output, 1400),
    });
  }

  const fileReads = input.changedFiles.slice(0, 20);
  const readResults = await runWithConcurrency(
    fileReads,
    6,
    async (filePath) => {
      const output = await read({
        path: filePath,
        lineStart: 1,
        maxLines: 260,
      });
      return { filePath, output };
    },
  );

  for (const item of readResults) {
    if (looksLikeErrorOutput(item.output)) {
      continue;
    }

    store.add({
      id: makeId("read-changed", item.filePath),
      source: "read-changed",
      file: item.filePath,
      text: textPreview(item.output, 1400),
    });
  }

  const skillFileJobs = input.routedSkills.flatMap((routed) =>
    routed.files.slice(0, 6).map((filePath) => ({ routed, filePath })),
  );
  const skillFileResults = await runWithConcurrency(
    skillFileJobs,
    6,
    async ({ routed, filePath }) => {
      const output = await read({
        path: filePath,
        lineStart: 1,
        maxLines: 220,
      });
      return { routed, filePath, output };
    },
  );
  for (const item of skillFileResults) {
    if (looksLikeErrorOutput(item.output)) {
      continue;
    }

    store.add({
      id: makeId(`read-skill-${item.routed.skill.name}`, item.filePath),
      source: "read-skill",
      file: item.filePath,
      skillName: item.routed.skill.name,
      text: textPreview(item.output, 1400),
    });
  }

  const skillSymbolJobs = input.routedSkills.flatMap((routed) =>
    routed.symbols.slice(0, 8).map((symbol) => ({ routed, symbol })),
  );
  const skillSymbolResults = await runWithConcurrency(
    skillSymbolJobs,
    6,
    async ({ routed, symbol }) => {
      const output = await grep({
        query: symbol,
        maxResults: 18,
        options: "--fixed-strings --line-number",
      });
      return { routed, symbol, output };
    },
  );
  for (const item of skillSymbolResults) {
    if (looksLikeErrorOutput(item.output)) {
      continue;
    }

    store.add({
      id: makeId(`grep-skill-${item.routed.skill.name}`, item.symbol),
      source: "grep-skill",
      skillName: item.routed.skill.name,
      text: textPreview(item.output, 1200),
    });
  }

  const globOutput = await glob({
    pattern: "*.{ts,tsx,js,jsx,sql,prisma}",
    path: ".",
    maxResults: 200,
    type: "f",
  });
  store.add({
    id: makeId("glob-root", "source-files"),
    source: "glob-root",
    text: textPreview(globOutput, 1400),
  });

  return store;
}
