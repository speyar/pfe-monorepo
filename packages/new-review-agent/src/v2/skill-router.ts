import type { DependencyMap, RoutedSkill, SkillDefinition } from "./types";

function simpleGlobMatch(pattern: string, value: string): boolean {
  if (pattern.startsWith("**/") && pattern.endsWith("/*")) {
    // Special handling for common patterns like "**/*.ts"
    const ext = pattern.slice(3, -2); // Extract .ts from "**/*.ts"
    return value.endsWith(ext);
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexText = `^${escaped.replace(/\*/g, ".*")}$`;
  return new RegExp(regexText, "i").test(value);
}

function pathSignalScore(path: string): number {
  const normalized = path.toLowerCase();
  let score = 0;

  // More precise matching with lower weights
  if (normalized.includes("/api/") || normalized.includes("/routes/")) {
    score += 3;
  }
  if (normalized.includes("/webhook")) {
    score += 3;
  }
  if (normalized.includes("review-agent")) {
    score += 4;
  }
  if (normalized.includes("/sandbox/")) {
    score += 2;
  }
  if (normalized.includes("/auth/") || normalized.includes("/security/")) {
    score += 2;
  }

  return score;
}

export function routeSkills(input: {
  dependencyMap: DependencyMap;
  skills: SkillDefinition[];
  maxSkills: number;
}): RoutedSkill[] {
  const scored: RoutedSkill[] = input.skills.map((skill) => {
    const reasons: string[] = [];
    let score = 0;

    // Tag matching - more precise scoring
    const tagHits = skill.triggers.tags.filter((tag) =>
      input.dependencyMap.tags.includes(tag),
    );
    if (tagHits.length > 0) {
      // Weight by specificity - fewer tags is better
      const tagScore = tagHits.length * 3;
      score += tagScore;
      reasons.push(`tags=${tagHits.join(",")}`);
    }

    // File pattern matching - improved scoring
    const fileHits = input.dependencyMap.nodes
      .map((node) => node.path)
      .filter((filePath) =>
        skill.triggers.filePatterns.some((pattern) =>
          simpleGlobMatch(pattern, filePath),
        ),
      );
    if (fileHits.length > 0) {
      // Score based on ratio of matched files to total changed files
      const fileRatio = Math.min(
        1.0,
        fileHits.length / Math.max(1, input.dependencyMap.nodes.length),
      );
      const fileScore = Math.floor(fileRatio * 15); // Max 15 points
      score += fileScore;
      reasons.push(`files=${fileHits.length}`);

      // Path signals with reduced impact
      const pathScore = fileHits
        .slice(0, 20) // Reduced from 40
        .reduce((sum, filePath) => sum + pathSignalScore(filePath), 0);
      if (pathScore > 0) {
        const pathContribution = Math.min(10, pathScore); // Reduced from 20
        score += pathContribution;
        reasons.push(`path-signals=${pathContribution}`);
      }
    }

    // Symbol pattern matching - improved scoring
    const symbolHits = input.dependencyMap.topSymbols.filter((symbol) =>
      skill.triggers.symbolPatterns.some((pattern) =>
        new RegExp(pattern, "i").test(symbol),
      ),
    );
    if (symbolHits.length > 0) {
      // Score based on ratio of matched symbols to top symbols
      const symbolRatio = Math.min(
        1.0,
        symbolHits.length / Math.max(1, input.dependencyMap.topSymbols.length),
      );
      const symbolScore = Math.floor(symbolRatio * 10); // Max 10 points
      score += symbolScore;
      reasons.push(`symbols=${symbolHits.length}`);
    }

    // Bonus for skills that match both files and symbols (indicates stronger relevance)
    if (fileHits.length > 0 && symbolHits.length > 0) {
      score += 5;
      reasons.push(`file-symbol-bonus`);
    }

    return {
      skill,
      score,
      reasons,
      files: fileHits.slice(0, 10),
      symbols: symbolHits.slice(0, 10),
    };
  });

  // Filter out very low score skills (less than 3 points)
  const filtered = scored.filter((item) => item.score >= 3);

  // Sort by score descending
  const sorted = filtered.sort((a, b) => b.score - a.score);

  // Take top skills, but ensure we have at least one if any skills exist
  const selectedCount = Math.min(Math.max(1, input.maxSkills), sorted.length);
  const selected = sorted.slice(0, selectedCount);

  // If no skills passed filtering but we have skills, take the highest scoring one
  if (selected.length === 0 && input.skills.length > 0) {
    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (best && best.skill) {
      return [
        {
          skill: best.skill,
          score: best.score,
          reasons: [...(best.reasons || []), "fallback"],
          files: best.files,
          symbols: best.symbols,
        },
      ];
    }
    // Fallback to first skill if somehow best is undefined
    return [
      {
        skill: input.skills[0]!,
        score: 1,
        reasons: ["fallback"],
        files: input.dependencyMap.hotFiles.slice(0, 5),
        symbols: input.dependencyMap.topSymbols.slice(0, 5),
      },
    ];
  }

  return selected;
}
