import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SkillDefinition, SkillTriggers } from "./types";

const DEFAULT_TRIGGERS: SkillTriggers = {
  tags: [],
  filePatterns: [],
  symbolPatterns: [],
};

function parseList(frontmatter: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `^${escaped}\\s*:\\s*\\n([\\s\\S]*?)(?=^\\w[\\w_-]*\\s*:|$)`,
    "m",
  );
  const section = sectionRegex.exec(frontmatter)?.[1];
  if (!section) {
    const inlineRegex = new RegExp(`^${escaped}\\s*:\\s*\\[(.*?)\\]\\s*$`, "m");
    const inline = inlineRegex.exec(frontmatter)?.[1];
    if (!inline) return [];
    return inline
      .split(",")
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) =>
      line
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    )
    .filter(Boolean);
}

function parseFrontmatter(content: string): {
  name: string;
  description: string;
  triggers: SkillTriggers;
  body: string;
} | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/m.exec(content);
  if (!match) {
    return null;
  }

  const frontmatter = match[1] ?? "";
  const body = (match[2] ?? "").trim();

  const get = (key: string): string => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped}\\s*:\\s*(.*?)\\s*$`, "m");
    const value = regex.exec(frontmatter)?.[1]?.trim();
    if (!value) {
      return "";
    }
    return value.replace(/^['"]|['"]$/g, "");
  };

  const name = get("name");
  const description = get("description");
  if (!name || !description) {
    return null;
  }

  return {
    name,
    description,
    body,
    triggers: {
      tags: parseList(frontmatter, "tags"),
      filePatterns: parseList(frontmatter, "file_patterns"),
      symbolPatterns: parseList(frontmatter, "symbol_patterns"),
    },
  };
}

export async function loadSkills(
  skillsRoot: string,
): Promise<SkillDefinition[]> {
  const files: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  }

  await visit(skillsRoot);

  const skills: SkillDefinition[] = [];

  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      continue;
    }

    skills.push({
      name: parsed.name,
      description: parsed.description,
      location: file,
      content: parsed.body,
      triggers: {
        tags:
          parsed.triggers.tags.length > 0
            ? parsed.triggers.tags
            : DEFAULT_TRIGGERS.tags,
        filePatterns:
          parsed.triggers.filePatterns.length > 0
            ? parsed.triggers.filePatterns
            : DEFAULT_TRIGGERS.filePatterns,
        symbolPatterns:
          parsed.triggers.symbolPatterns.length > 0
            ? parsed.triggers.symbolPatterns
            : DEFAULT_TRIGGERS.symbolPatterns,
      },
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
