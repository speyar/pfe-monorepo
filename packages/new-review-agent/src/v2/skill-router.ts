import type { DependencyMap, RoutedSkill, SkillDefinition } from "./types";

function simpleGlobMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexText = `^${escaped.replace(/\*/g, ".*")}$`;
  return new RegExp(regexText, "i").test(value);
}

export function routeSkills(input: {
  dependencyMap: DependencyMap;
  skills: SkillDefinition[];
  maxSkills: number;
}): RoutedSkill[] {
  const scored: RoutedSkill[] = input.skills.map((skill) => {
    const reasons: string[] = [];
    let score = 0;

    const tagHits = skill.triggers.tags.filter((tag) =>
      input.dependencyMap.tags.includes(tag),
    );
    if (tagHits.length > 0) {
      score += tagHits.length * 5;
      reasons.push(`tags=${tagHits.join(",")}`);
    }

    const fileHits = input.dependencyMap.nodes
      .map((node) => node.path)
      .filter((filePath) =>
        skill.triggers.filePatterns.some((pattern) =>
          simpleGlobMatch(pattern, filePath),
        ),
      );
    if (fileHits.length > 0) {
      score += Math.min(12, fileHits.length * 2);
      reasons.push(`files=${fileHits.length}`);
    }

    const symbolHits = input.dependencyMap.topSymbols.filter((symbol) =>
      skill.triggers.symbolPatterns.some((pattern) =>
        new RegExp(pattern, "i").test(symbol),
      ),
    );
    if (symbolHits.length > 0) {
      score += Math.min(12, symbolHits.length * 2);
      reasons.push(`symbols=${symbolHits.length}`);
    }

    return {
      skill,
      score,
      reasons,
      files: fileHits.slice(0, 10),
      symbols: symbolHits.slice(0, 10),
    };
  });

  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, input.maxSkills));

  if (selected.length === 0 && input.skills.length > 0) {
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
