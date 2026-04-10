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

/**
 * Estimate token count for text using a simple approximation.
 * This is a rough estimate - approximately 4 characters per token for English text.
 * For more accurate counting, you would need to use a tokenizer specific to the model.
 */
export function estimateTokenCount(text: string): number {
  // Simple approximation: 4 characters per token on average
  // This works reasonably well for English text and code
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a maximum token count.
 * Returns the truncated text and information about the truncation.
 */
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

  // Approximate character limit based on token limit
  const charLimit = maxTokens * 4;
  const truncatedText = text.slice(0, charLimit);

  // Try to end at a line boundary for better readability
  const lastNewline = truncatedText.lastIndexOf("\n");
  if (lastNewline > charLimit * 0.8) {
    // Only if we don't lose too much content
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
