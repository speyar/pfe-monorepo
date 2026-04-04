export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

export function isToolDebugEnabled(): boolean {
  return process.env.NEW_REVIEW_AGENT_DEBUG_TOOLS === "1";
}

export function previewText(text: string, maxChars = 400): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export function logToolEvent(input: {
  tool: string;
  phase: "start" | "finish";
  payload: unknown;
}): void {
  if (!isToolDebugEnabled()) {
    return;
  }

  console.log(`[tool:${input.tool}] ${input.phase}`, input.payload);
}

export function toSandboxPath(path: string): string {
  const normalized = normalizePath(path);
  return normalized;
}

export function splitOptions(options?: string): string[] {
  if (!options) {
    return [];
  }

  return options
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function normalizeCommandResult(result: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
  };
}

export function truncateByLines(text: string, maxLines: number): string {
  if (maxLines < 1) {
    return "";
  }

  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }

  return `${lines.slice(0, maxLines).join("\n")}\n... [truncated ${lines.length - maxLines} lines]`;
}
