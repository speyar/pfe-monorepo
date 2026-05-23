import type { LanguageModel, Tool } from "ai";
import type { SandboxManager } from "@packages/sandbox";
import { runSubAgent, type RunSubAgentOutput } from "../sub-agents/base";
import { SUB_AGENTS, type SubAgentDefinition } from "../sub-agents/registry";
import type { SharedContext } from "./shared-context";

export interface SubAgentRunnerInput {
  model: LanguageModel;
  sandboxManager: SandboxManager;
  sandboxId: string;
  sharedContext: SharedContext;
  tools: Record<string, Tool>;
  concurrency?: number;
  signal?: AbortSignal;
}

async function mapWithConcurrency<T, R>(input: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const results: R[] = new Array(input.items.length);
  const concurrency = Math.max(1, input.concurrency);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < input.items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await input.worker(
        input.items[currentIndex] as T,
        currentIndex,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, input.items.length) }, () =>
      runWorker(),
    ),
  );

  return results;
}

async function runSingleSubAgent(
  definition: SubAgentDefinition,
  input: SubAgentRunnerInput,
): Promise<RunSubAgentOutput> {
  const startedAt = Date.now();
  console.log(`[sub-agent-runner] starting ${definition.agentId}`);

  const result = await runSubAgent({
    agentId: definition.agentId,
    agentPrompt: definition.systemPrompt,
    model: input.model,
    sandboxManager: input.sandboxManager,
    sandboxId: input.sandboxId,
    sharedContext: input.sharedContext,
    tools: input.tools,
    maxToolSteps: definition.maxToolSteps,
    minToolSteps: definition.minToolSteps,
    signal: input.signal,
  });

  console.log(
    `[sub-agent-runner] ${definition.agentId} finished — ${result.findings.length} findings (${Date.now() - startedAt}ms)`,
  );

  return result;
}

export async function runSubAgents(
  input: SubAgentRunnerInput,
): Promise<RunSubAgentOutput[]> {
  const maxConcurrency = input.concurrency ?? 4;
  const startedAt = Date.now();

  console.log(
    `[sub-agent-runner] launching ${SUB_AGENTS.length} sub-agents at concurrency ${maxConcurrency}`,
  );

  const results = await mapWithConcurrency({
    items: SUB_AGENTS,
    concurrency: maxConcurrency,
    worker: (definition) => runSingleSubAgent(definition, input),
  });

  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const errorCount = results.filter((r) => r.findings.length === 0).length;

  console.log(
    `[sub-agent-runner] all done — ${results.length}/${SUB_AGENTS.length} agents, ${totalFindings} total findings, ${errorCount} agents with no findings (${Date.now() - startedAt}ms)`,
  );

  return results;
}
