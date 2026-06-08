export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  calls: number;
};

const totals: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  calls: 0,
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

export function resetUsageTelemetry(): void {
  totals.inputTokens = 0;
  totals.outputTokens = 0;
  totals.totalTokens = 0;
  totals.reasoningTokens = 0;
  totals.cachedInputTokens = 0;
  totals.calls = 0;
}

export function addUsageTelemetry(raw: unknown): void {
  if (!raw || typeof raw !== "object") {
    return;
  }

  const usage = raw as Record<string, unknown>;
  const inputTokens =
    toNumber(usage.inputTokens) ||
    toNumber(usage.promptTokens) ||
    toNumber(usage.prompt_tokens);
  const outputTokens =
    toNumber(usage.outputTokens) ||
    toNumber(usage.completionTokens) ||
    toNumber(usage.completion_tokens);
  const totalTokens =
    toNumber(usage.totalTokens) ||
    toNumber(usage.total_tokens) ||
    inputTokens + outputTokens;
  const reasoningTokens =
    toNumber(usage.reasoningTokens) ||
    toNumber(usage.reasoning_tokens) ||
    toNumber(
      (usage.outputTokenDetails as Record<string, unknown> | undefined)
        ?.reasoningTokens,
    ) ||
    toNumber(
      (usage.completion_tokens_details as Record<string, unknown> | undefined)
        ?.reasoning_tokens,
    );
  const cachedInputTokens =
    toNumber(usage.cachedInputTokens) ||
    toNumber(usage.cached_tokens) ||
    toNumber(
      (usage.inputTokenDetails as Record<string, unknown> | undefined)
        ?.cacheReadTokens,
    ) ||
    toNumber(
      (usage.prompt_tokens_details as Record<string, unknown> | undefined)
        ?.cached_tokens,
    );

  totals.inputTokens += inputTokens;
  totals.outputTokens += outputTokens;
  totals.totalTokens += totalTokens;
  totals.reasoningTokens += reasoningTokens;
  totals.cachedInputTokens += cachedInputTokens;
  totals.calls += 1;
}

export function getUsageTelemetry(): UsageTotals {
  return { ...totals };
}
