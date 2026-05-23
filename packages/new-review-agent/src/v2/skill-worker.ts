import { generateObject, generateText, type LanguageModel } from "ai";
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
  shouldComment: z.boolean().optional(),
  whyNot: z.string().max(500).optional(),
});

const fallbackSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
        quote: z.string().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        suggestion: z.string().optional(),
      }),
    )
    .optional(),
});

interface SkillPromptInput {
  skill: RoutedSkill;
  dependencyMap: DependencyMap;
  evidenceText: string;
  maxFindings: number;
}

function buildSkillPrompt(input: SkillPromptInput): string {
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
    "General reviewer goals (apply even if not explicitly covered by this skill):",
    "- Find behavioral regressions that could break runtime behavior, correctness, or reliability.",
    "- Trace cross-file impact from changed logic into unchanged callers/callees.",
    "- Prioritize high-impact failures: crashes, invalid state, broken contracts, race windows, data loss.",
    "",
    "Rules:",
    "- Report likely regressions, including medium-confidence suspicions when evidence suggests real risk.",
    "- Prioritize issues on changed lines and nearby affected logic.",
    "- Include cross-file impacts when changed behavior can break unchanged callers/callees.",
    "- Avoid generic style advice; focus on behavioral or reliability risk.",
    "- Include quote when available, but do not suppress a finding solely because quote extraction is imperfect.",
    "- Keep findings concise and actionable.",
    `- Return at most ${input.maxFindings} findings.`,
    "",
    "Output contract:",
    "- Return JSON with fields: findings, shouldComment (optional), whyNot (optional).",
    "- If findings is empty and you still think maintainers should know context, set shouldComment=true and explain in whyNot.",
    "- Never place meta/debug text inside any finding.message.",
  ].join("\n");
}

function scoreEvidenceText(evidenceText: string): number {
  const text = evidenceText.toLowerCase();
  let score = 0;
  if (text.includes("[diff-changed]")) {
    score += 3;
  }
  if (text.includes("[read-changed]")) {
    score += 2;
  }
  if (text.includes("[read-skill]")) {
    score += 1;
  }
  if (text.includes("error:")) {
    score -= 2;
  }
  return score;
}

export async function runSkillWorker(input: {
  model: LanguageModel;
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
    .slice(0, 28)
    .map((item, index) => {
      const file = item.file ? ` file=${item.file}` : "";
      return `${index + 1}. [${item.source}]${file}\n${item.text}`;
    })
    .join("\n\n");

  const evidenceScore = scoreEvidenceText(evidence);

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

  const baseParams = {
    model: input.model,
    system,
    prompt,
    abortSignal: input.signal,
  };

  let resultObj: {
    findings: Array<{
      severity: "critical" | "high" | "medium" | "low" | "info";
      file?: string;
      line?: number;
      quote?: string;
      title: string;
      message: string;
      suggestion?: string;
    }>;
    shouldComment?: boolean;
    whyNot?: string;
  };

  try {
    const genResult = await generateObject({
      ...baseParams,
      schema: outputSchema,
    });
    resultObj = genResult.object as typeof resultObj;
  } catch (error) {
    debug("worker-generate-object-failed", {
      skill: input.skill.skill.name,
      error: error instanceof Error ? error.message : String(error),
      strategy: "retry-with-fallback-schema",
    });

    try {
      const fallbackResult = await generateObject({
        ...baseParams,
        schema: fallbackSchema,
      });

      const rawFindings =
        (fallbackResult.object as { findings?: Array<{ severity: string; file?: string; line?: number; quote?: string; title?: string; message?: string; suggestion?: string }> }).findings ?? [];

      const fallbackFindings = rawFindings
        .map((finding) => {
          const title = finding.title?.trim();
          const message = finding.message?.trim();
          if (!title || !message) {
            return null;
          }
          return {
            severity: finding.severity as "critical" | "high" | "medium" | "low" | "info",
            file: finding.file,
            line: finding.line,
            quote: finding.quote,
            title,
            message,
            suggestion: finding.suggestion,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      resultObj = {
        findings: fallbackFindings,
        shouldComment: true,
        whyNot:
          fallbackFindings.length === 0
            ? "Primary schema failed and fallback produced no complete findings."
            : "Primary schema failed; findings recovered with fallback schema.",
      };
    } catch (fallbackError) {
      debug("worker-fallback-failed", {
        skill: input.skill.skill.name,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
        strategy: "retry-with-generateText",
      });

      try {
        const textResult = await generateText({
          ...baseParams,
        });

        const parsed = parseFindingsFromText(textResult.text);
        if (parsed.length > 0) {
          resultObj = {
            findings: parsed.slice(0, input.maxFindingsPerSkill),
            shouldComment: true,
            whyNot: "Schema-based generation failed; findings recovered from raw text.",
          };
        } else {
          debug("worker-text-fallback-empty", {
            skill: input.skill.skill.name,
          });
          return [];
        }
      } catch (textError) {
        debug("worker-text-fallback-failed", {
          skill: input.skill.skill.name,
          error:
            textError instanceof Error
              ? textError.message
              : String(textError),
        });
        return [];
      }
    }
  }

  const findings: V2ReviewFinding[] = resultObj.findings.map(
    (finding) => ({
      ...finding,
      skill: input.skill.skill.name,
    }),
  );

  debug("worker-end", {
    skill: input.skill.skill.name,
    findings: findings.length,
    severities: findings.map((f) => f.severity),
    shouldComment: resultObj.shouldComment ?? false,
    whyNot: resultObj.whyNot,
    evidenceScore,
  });

  if (findings.length === 0) {
    debug("worker-zero-findings", {
      skill: input.skill.skill.name,
      evidenceCount: input.evidenceStore.listBySkill(
        input.skill.skill.name,
      ).length,
      routedFiles: input.skill.files,
      routedSymbols: input.skill.symbols,
      shouldComment: resultObj.shouldComment ?? false,
      whyNot: resultObj.whyNot,
      evidenceScore,
    });
  }

  return findings;
}

function parseFindingsFromText(
  text: string,
): Array<{
  severity: "critical" | "high" | "medium" | "low" | "info";
  file?: string;
  line?: number;
  quote?: string;
  title: string;
  message: string;
  suggestion?: string;
}> {
  try {
    const cleaned = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (f) => typeof f === "object" && f !== null && typeof f.title === "string" && typeof f.message === "string",
        )
        .map((f) => ({
          severity: validateSeverity(f.severity),
          file: typeof f.file === "string" ? f.file : undefined,
          line: typeof f.line === "number" ? f.line : undefined,
          quote: typeof f.quote === "string" ? f.quote : undefined,
          title: f.title,
          message: f.message,
          suggestion: typeof f.suggestion === "string" ? f.suggestion : undefined,
        }));
    }

    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>).findings)) {
      return ((parsed as Record<string, unknown>).findings as Array<Record<string, unknown>>)
        .filter(
          (f) => typeof f === "object" && f !== null && typeof f.title === "string" && typeof f.message === "string",
        )
        .map((f) => ({
          severity: validateSeverity(f.severity),
          file: typeof f.file === "string" ? f.file : undefined,
          line: typeof f.line === "number" ? f.line : undefined,
          quote: typeof f.quote === "string" ? f.quote : undefined,
          title: f.title as string,
          message: f.message as string,
          suggestion: typeof f.suggestion === "string" ? f.suggestion : undefined,
        }));
    }

    return [];
  } catch {
    return [];
  }
}

function validateSeverity(
  value: unknown,
): "critical" | "high" | "medium" | "low" | "info" {
  const valid = ["critical", "high", "medium", "low", "info"];
  if (typeof value === "string" && valid.includes(value)) {
    return value as "critical" | "high" | "medium" | "low" | "info";
  }
  return "medium";
}
