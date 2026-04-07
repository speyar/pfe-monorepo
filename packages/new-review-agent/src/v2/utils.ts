import type { SandboxManager } from "@packages/sandbox";

export function normalizeBranchName(value: string): string {
  return value.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function pathExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(".");
  if (index <= -1) {
    return "";
  }
  return normalized.slice(index).toLowerCase();
}

export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function capList<T>(items: T[], max: number): T[] {
  if (!Number.isInteger(max) || max < 1) {
    return items;
  }
  return items.length > max ? items.slice(0, max) : items;
}

export function textPreview(value: string, maxChars = 500): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} chars]`;
}

export async function runCommand(
  sandboxManager: SandboxManager,
  sandboxId: string,
  command: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await sandboxManager.runCommand({
      sandboxId,
      command,
      args,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
    };
  }
}
