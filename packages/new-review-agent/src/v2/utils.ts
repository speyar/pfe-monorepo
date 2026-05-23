import type { SandboxManager } from "@packages/sandbox";
import { debug } from "./debug";

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
  if (process.env.NEW_REVIEW_AGENT_LOG_FULL_OUTPUT === "1") {
    return value;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} chars]`;
}

export function isSecurityCriticalFile(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return (
    normalized.includes("/api/") ||
    normalized.endsWith("route.ts") ||
    normalized.endsWith("route.tsx") ||
    normalized.includes("middleware") ||
    normalized.includes("/auth/") ||
    normalized.includes("/webhooks/")
  );
}

export function smartTruncateDiff(diff: string, maxChars: number, filePath?: string): string {
  if (diff.length <= maxChars) {
    return diff;
  }

  const effectiveMax = filePath && isSecurityCriticalFile(filePath)
    ? Math.max(maxChars, Math.floor(maxChars * 2.5))
    : maxChars;

  if (diff.length <= effectiveMax) {
    return diff;
  }

  const lines = diff.split(/\r?\n/);
  const output: string[] = [];
  let currentLength = 0;
  let inImportBlock = true;
  let importsEnded = false;
  let inHunk = false;
  let currentHunkLines: string[] = [];

  function flushHunk() {
    if (currentHunkLines.length === 0) return;
    const hunkText = currentHunkLines.join("\n");
    if (currentLength + hunkText.length + 1 > effectiveMax) return;
    output.push(hunkText);
    currentLength += hunkText.length + 1;
    currentHunkLines = [];
  }

  for (const line of lines) {
    const lineLen = line.length + 1;

    if (inImportBlock && !importsEnded) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("import ") ||
        trimmed.startsWith("export ") ||
        trimmed.startsWith("const ") ||
        trimmed.startsWith("let ") ||
        trimmed.startsWith("var ") ||
        trimmed.startsWith("type ") ||
        trimmed.startsWith("interface ") ||
        trimmed.startsWith("function ") ||
        trimmed.startsWith("class ") ||
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("}")
      ) {
        if (
          trimmed !== "" &&
          !trimmed.startsWith("import ") &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("*") &&
          !trimmed.startsWith("}")
        ) {
          importsEnded = true;
          inImportBlock = false;
          inHunk = false;
        } else if (trimmed.startsWith("import ")) {
          if (currentLength + lineLen <= effectiveMax) {
            output.push(line);
            currentLength += lineLen;
          }
          continue;
        } else {
          if (currentLength + lineLen <= effectiveMax) {
            output.push(line);
            currentLength += lineLen;
          }
          continue;
        }
      } else {
        importsEnded = true;
        inImportBlock = false;
        inHunk = false;
      }
    }

    const isHunkHeader = line.startsWith("@@ ");
    const isChangeLine = line.startsWith("+") || line.startsWith("-");
    const isDiffHeader =
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ");

    if (isHunkHeader) {
      flushHunk();
      inHunk = true;
    }

    if (isDiffHeader) {
      if (currentLength + lineLen <= effectiveMax) {
        output.push(line);
        currentLength += lineLen;
      }
      continue;
    }

    if (inHunk) {
      if (isChangeLine) {
        flushHunk();
        currentHunkLines.push(line);
      } else if (isHunkHeader) {
        currentHunkLines.push(line);
      } else {
        currentHunkLines.push(line);
        if (currentHunkLines.length > 5) {
          currentHunkLines.splice(0, currentHunkLines.length - 6);
        }
      }
    } else {
      if (currentLength + lineLen <= effectiveMax) {
        output.push(line);
        currentLength += lineLen;
      } else {
        output.push(`... [truncated ${diff.length - currentLength} chars]`);
        break;
      }
    }
  }

  flushHunk();

  if (currentLength < effectiveMax && currentHunkLines.length > 0) {
    const hunkText = currentHunkLines.join("\n");
    if (currentLength + hunkText.length + 1 <= effectiveMax) {
      output.push(hunkText);
    }
  }

  return output.join("\n");
}

export async function runCommand(
  sandboxManager: SandboxManager,
  sandboxId: string,
  command: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  debug("sandbox-command-start", {
    sandboxId,
    command,
    args,
  });
  try {
    const result = await sandboxManager.runCommand({
      sandboxId,
      command,
      args,
    });
    const normalized = {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
    debug("sandbox-command-finish", {
      sandboxId,
      command,
      args,
      exitCode: normalized.exitCode,
      stdout: textPreview(normalized.stdout, 280),
      stderr: textPreview(normalized.stderr, 280),
    });
    return {
      stdout: normalized.stdout,
      stderr: normalized.stderr,
      exitCode: normalized.exitCode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debug("sandbox-command-error", {
      sandboxId,
      command,
      args,
      error: message,
    });
    return {
      stdout: "",
      stderr: message,
      exitCode: 127,
    };
  }
}
