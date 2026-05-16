export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

export function isToolDebugEnabled(): boolean {
  return process.env.MECHANIC_AGENT_DEBUG_TOOLS === "1";
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
  return normalizePath(path);
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

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateByTokens(
  text: string,
  maxTokens: number,
): {
  text: string;
  truncated: boolean;
  estimatedTokens: number;
} {
  if (maxTokens <= 0) {
    return {
      text: "",
      truncated: true,
      estimatedTokens: 0,
    };
  }

  const estimatedTokens = estimateTokenCount(text);

  if (estimatedTokens <= maxTokens) {
    return {
      text,
      truncated: false,
      estimatedTokens,
    };
  }

  const charLimit = maxTokens * 4;
  const truncatedText = text.slice(0, charLimit);

  const lastNewline = truncatedText.lastIndexOf("\n");
  if (lastNewline > charLimit * 0.8) {
    return {
      text: truncatedText.slice(0, lastNewline),
      truncated: true,
      estimatedTokens: estimateTokenCount(truncatedText.slice(0, lastNewline)),
    };
  }

  return {
    text: truncatedText,
    truncated: true,
    estimatedTokens: estimateTokenCount(truncatedText),
  };
}
