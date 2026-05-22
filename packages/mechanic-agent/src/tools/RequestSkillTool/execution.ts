import type { Skill } from "../../types";

export function createRequestSkillExecutor(skills: Skill[]) {
  return async (input: { name: string }): Promise<string> => {
    const skill = skills.find(
      (s) => s.name.toLowerCase() === input.name.toLowerCase(),
    );

    if (!skill) {
      return `Error: Skill "${input.name}" not found. Available skills: ${skills.map((s) => `"${s.name}"`).join(", ") || "(none)"}`;
    }

    return [
      `## Skill: ${skill.name}`,
      `**Use Case**: ${skill.useCase}`,
      `**Description**: ${skill.description}`,
      ``,
      skill.content,
    ].join("\n");
  };
}
