import { generateObject } from "ai";
import { z } from "zod";
import type { EvidenceStore } from "./evidence-store";
import type { DependencyMap, RoutedSkill, V2ReviewFinding } from "./types";
import { debug } from "./debug";

const findingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  quote: z.string().optional(),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  suggestion: z.string().optional(),
});

const outputSchema = z.object({
  findings: z.array(findingSchema),
});

function buildSkillPrompt(input: {
  skill: RoutedSkill;
  dependencyMap: DependencyMap;
  evidenceText: string;
  maxFindings: number;
}): string {
  return [
    `Skill: ${input.skill.skill.name}`,
    `Description: ${input.skill.skill.description}`,
    `Routing score: ${input.skill.score}`,
    `Routing reasons: ${input.skill.reasons.join(", ") || "none"}`,
    `Selected files: ${input.skill.files.join(", ") || "none"}`,
    `Selected symbols: ${input.skill.symbols.join(", ") || "none"}`,
    "",
    "Dependency map summary:",
    ...input.dependencyMap.summary,
    "",
    "Skill instructions:",
    input.skill.skill.content,
    "",
    "Evidence:",
    input.evidenceText || "No evidence collected.",
    "",
    "Rules:",
    "- Report only high-confidence issues.",
    "- Keep findings concise and actionable.",
    "- If evidence is weak, return no finding.",
    `- Return at most ${input.maxFindings} findings.`,
  ].join("\n");
}

export async function runSkillWorker(input: {
  model: Parameters<typeof generateObject>[0]["model"];
  skill: RoutedSkill;
  dependencyMap: DependencyMap;
  evidenceStore: EvidenceStore;
  signal?: AbortSignal;
  maxFindingsPerSkill: number;
}): Promise<V2ReviewFinding[]> {
  debug("worker-start", {
    skill: input.skill.skill.name,
    files: input.skill.files.length,
    symbols: input.skill.symbols.length,
  });

  const evidence = input.evidenceStore
    .listBySkill(input.skill.skill.name)
    .slice(0, 8)
    .map((item, index) => {
      const file = item.file ? ` file=${item.file}` : "";
      return `${index + 1}. [${item.source}]${file}\n${item.text}`;
    })
    .join("\n\n");

  const system = [
    "You are a specialized pull request review worker.",
    "You must output strict JSON matching schema.",
    "Do not output markdown.",
  ].join(" ");

  const prompt = buildSkillPrompt({
    skill: input.skill,
    dependencyMap: input.dependencyMap,
    evidenceText: evidence,
    maxFindings: input.maxFindingsPerSkill,
  });

  const result = await generateObject({
    model: input.model,
    system,
    prompt,
    schema: outputSchema,
    temperature: 0.1,
    abortSignal: input.signal,
  });

  const findings = result.object.findings.map((finding) => ({
    ...finding,
    skill: input.skill.skill.name,
  }));
  debug("worker-end", {
    skill: input.skill.skill.name,
    findings: findings.length,
    severities: findings.map((f) => f.severity),
  });

  return findings;
}
