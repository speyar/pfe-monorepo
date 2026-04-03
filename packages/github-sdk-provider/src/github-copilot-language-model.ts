/**
 * Core LanguageModelV3 implementation for GitHub Copilot SDK.
 *
 * Each `doGenerate()` / `doStream()` call creates a fresh CopilotSession,
 * sends the flattened prompt, collects the response, then destroys the session.
 * The CopilotClient is long-lived and managed by CopilotClientManager.
 */
import { randomUUID } from "node:crypto";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { CopilotClientManager } from "./client-manager";
import type { CopilotSession } from "./copilot-session";
import { mapCopilotError } from "./error";
import { mapMessages } from "./message-mapper";
import {
  type CopilotToolRequest,
  mapCopilotToolRequestToContent,
  mapToolsToCopilotFormat,
} from "./tool-mapper";
import type {
  GitHubCopilotModelSettings,
  GitHubCopilotProviderOptions,
} from "./types";

const DEFAULT_TIMEOUT = 120_000; // 2 minutes

interface CopilotCallProviderOptions {
  conversationId?: string;
  reuseSession?: boolean;
}

interface ConversationSessionState {
  session: CopilotSession;
  lastPrompt: string;
  systemMessage?: string;
  toolNames: string[];
  availableTools?: string[];
}

function areEqualStringSets(
  left: string[] = [],
  right: string[] = [],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();

  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export class GitHubCopilotLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "github-copilot";
  readonly defaultObjectGenerationMode = undefined;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = false;

  readonly modelId: string;
  private readonly clientManager: CopilotClientManager;
  private readonly providerOptions: GitHubCopilotProviderOptions;
  private readonly modelSettings: GitHubCopilotModelSettings;
  private readonly conversationSessions = new Map<
    string,
    ConversationSessionState
  >();

  constructor(options: {
    modelId: string;
    clientManager: CopilotClientManager;
    providerOptions: GitHubCopilotProviderOptions;
    modelSettings?: GitHubCopilotModelSettings;
  }) {
    this.modelId = options.modelId;
    this.clientManager = options.clientManager;
    this.providerOptions = options.providerOptions;
    this.modelSettings = options.modelSettings ?? {};
  }

  private get timeout(): number {
    return (
      this.modelSettings.timeout ??
      this.providerOptions.timeout ??
      DEFAULT_TIMEOUT
    );
  }

  private getBuiltInToolFilter(): {
    availableTools?: string[];
    excludedTools?: string[];
  } {
    const configured =
      this.modelSettings.builtInTools ??
      this.providerOptions.builtInTools ??
      "none";

    if (configured === "all") {
      return {};
    }

    if (configured === "none") {
      return { availableTools: [] };
    }

    const availableTools = Array.from(
      new Set(
        configured.map((name) => name.trim()).filter((name) => name.length > 0),
      ),
    );

    return { availableTools };
  }

  /**
   * Extract function tools from the options' tools array.
   */
  private getFunctionTools(
    options: LanguageModelV3CallOptions,
  ): LanguageModelV3FunctionTool[] {
    if (!options.tools || options.tools.length === 0) return [];
    return options.tools.filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === "function",
    );
  }

  private getCopilotCallOptions(options: LanguageModelV3CallOptions): {
    conversationId?: string;
    reuseSession: boolean;
  } {
    const providerOptions = options.providerOptions as
      | Record<string, unknown>
      | undefined;
    const providerEntry = providerOptions?.[this.provider] as
      | CopilotCallProviderOptions
      | undefined;

    const conversationId =
      providerEntry && typeof providerEntry.conversationId === "string"
        ? providerEntry.conversationId
        : undefined;

    const reuseSession = providerEntry?.reuseSession !== false;

    return {
      conversationId,
      reuseSession,
    };
  }

  private getToolNames(tools: LanguageModelV3FunctionTool[]): string[] {
    return tools.map((tool) => tool.name);
  }

  private async destroyConversationSession(
    conversationId: string,
  ): Promise<void> {
    const existing = this.conversationSessions.get(conversationId);
    if (!existing) {
      return;
    }

    this.conversationSessions.delete(conversationId);
    await existing.session.destroy().catch(() => {});
  }

  private async resolveSession(input: {
    options: LanguageModelV3CallOptions;
    systemMessage?: string;
    copilotTools?: ReturnType<typeof mapToolsToCopilotFormat>;
    builtInToolFilter: { availableTools?: string[]; excludedTools?: string[] };
    toolNames: string[];
    effectivePrompt: string;
    streaming: boolean;
  }): Promise<{
    session: CopilotSession;
    shouldDestroyAfterCall: boolean;
    promptToSend: string;
  }> {
    const {
      options,
      systemMessage,
      copilotTools,
      builtInToolFilter,
      toolNames,
      effectivePrompt,
      streaming,
    } = input;

    const { conversationId, reuseSession } =
      this.getCopilotCallOptions(options);
    const client = await this.clientManager.getClient();

    if (!conversationId || !reuseSession) {
      const session = await client.createSession({
        model: this.modelId,
        streaming,
        systemMessage: systemMessage
          ? { mode: "append", content: systemMessage }
          : undefined,
        tools: copilotTools,
        ...builtInToolFilter,
      });

      return {
        session,
        shouldDestroyAfterCall: true,
        promptToSend: effectivePrompt,
      };
    }

    const availableTools = builtInToolFilter.availableTools ?? [];
    const existing = this.conversationSessions.get(conversationId);

    const shouldRecreate =
      !existing ||
      existing.systemMessage !== systemMessage ||
      !areEqualStringSets(existing.toolNames, toolNames) ||
      !areEqualStringSets(existing.availableTools ?? [], availableTools);

    if (shouldRecreate) {
      if (existing) {
        await this.destroyConversationSession(conversationId);
      }

      const session = await client.createSession({
        model: this.modelId,
        streaming,
        systemMessage: systemMessage
          ? { mode: "append", content: systemMessage }
          : undefined,
        tools: copilotTools,
        ...builtInToolFilter,
      });

      this.conversationSessions.set(conversationId, {
        session,
        lastPrompt: effectivePrompt,
        systemMessage,
        toolNames,
        availableTools,
      });

      return {
        session,
        shouldDestroyAfterCall: false,
        promptToSend: effectivePrompt,
      };
    }

    const promptToSend = effectivePrompt.startsWith(existing.lastPrompt)
      ? effectivePrompt.slice(existing.lastPrompt.length).trimStart()
      : effectivePrompt;

    existing.lastPrompt = effectivePrompt;

    return {
      session: existing.session,
      shouldDestroyAfterCall: false,
      promptToSend: promptToSend || effectivePrompt,
    };
  }

  /**
   * Non-streaming text generation.
   *
   * Creates a session with streaming disabled, calls `sendAndWait()`,
   * then maps the response to AI SDK format.
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<{
    content: LanguageModelV3Content[];
    finishReason: LanguageModelV3FinishReason;
    usage: LanguageModelV3Usage;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
    rawResponse?: { body?: unknown };
    response?: { id?: string; timestamp?: Date; modelId?: string };
    warnings: SharedV3Warning[];
  }> {
    const warnings: SharedV3Warning[] = [];
    const { systemMessage, prompt } = mapMessages(options.prompt);
    const functionTools = this.getFunctionTools(options);
    const toolChoiceInstruction = buildToolChoicePromptInstruction({
      toolChoice: getRequestedToolChoice(options),
      toolNames: this.getToolNames(functionTools),
    });
    const effectivePrompt = toolChoiceInstruction
      ? [toolChoiceInstruction, prompt].filter(Boolean).join("\n\n")
      : prompt;

    if (options.responseFormat?.type === "json") {
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details:
          "JSON response format is not natively supported. The model may or may not return valid JSON.",
      });
    }

    // Map AI SDK tools to Copilot SDK format
    const copilotTools =
      functionTools.length > 0
        ? mapToolsToCopilotFormat(functionTools)
        : undefined;
    const builtInToolFilter = this.getBuiltInToolFilter();
    const toolNames = this.getToolNames(functionTools);

    const { session, shouldDestroyAfterCall, promptToSend } =
      await this.resolveSession({
        options,
        systemMessage,
        copilotTools,
        builtInToolFilter,
        toolNames,
        effectivePrompt,
        streaming: false,
      });

    try {
      // Check abort before sending
      if (options.abortSignal?.aborted) {
        throw createAbortError();
      }

      const response = await session.sendAndWait(
        { prompt: promptToSend },
        this.timeout,
      );

      // Check abort after receiving
      if (options.abortSignal?.aborted) {
        throw createAbortError();
      }

      const text = response?.data.content ?? "";
      const messageId = response?.data.messageId ?? randomUUID();
      const toolRequests = (response?.data.toolRequests ??
        []) as CopilotToolRequest[];

      const content: LanguageModelV3Content[] = [];
      if (text) {
        content.push({ type: "text", text });
      }

      // Map tool requests to AI SDK tool-call content parts
      for (const req of toolRequests) {
        content.push(mapCopilotToolRequestToContent(req));
      }

      // Determine finish reason: tool-calls if there are tool requests
      const hasToolCalls = toolRequests.length > 0;
      const finishReason: LanguageModelV3FinishReason = hasToolCalls
        ? { unified: "tool-calls", raw: "tool-calls" }
        : { unified: "stop", raw: "stop" };

      // We don't get token counts from sendAndWait — usage events are only
      // fired as session events. For non-streaming, we report unknown usage.
      const usage: LanguageModelV3Usage = {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      };

      return {
        content,
        finishReason,
        usage,
        rawCall: {
          rawPrompt: { systemMessage, prompt: effectivePrompt },
          rawSettings: {
            model: this.modelId,
            streaming: false,
            tools: copilotTools?.map((t) => t.name),
            availableTools: builtInToolFilter.availableTools,
            providerOptions: options.providerOptions,
          },
        },
        rawResponse: { body: response },
        response: {
          id: messageId,
          timestamp: new Date(),
          modelId: this.modelId,
        },
        warnings,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw mapCopilotError(error);
    } finally {
      if (shouldDestroyAfterCall) {
        await session.destroy().catch(() => {});
      }
    }
  }

  /**
   * Streaming text generation.
   *
   * Creates a session with streaming enabled, sends the prompt, then
   * listens for `assistant.message_delta`, `assistant.message`,
   * `assistant.usage`, and `session.idle` events to produce the
   * ReadableStream of LanguageModelV3StreamPart.
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    const warnings: SharedV3Warning[] = [];
    const { systemMessage, prompt } = mapMessages(options.prompt);
    const functionTools = this.getFunctionTools(options);
    const toolChoiceInstruction = buildToolChoicePromptInstruction({
      toolChoice: getRequestedToolChoice(options),
      toolNames: this.getToolNames(functionTools),
    });
    const effectivePrompt = toolChoiceInstruction
      ? [toolChoiceInstruction, prompt].filter(Boolean).join("\n\n")
      : prompt;

    if (options.responseFormat?.type === "json") {
      warnings.push({
        type: "unsupported",
        feature: "responseFormat",
        details:
          "JSON response format is not natively supported. The model may or may not return valid JSON.",
      });
    }

    // Map AI SDK tools to Copilot SDK format
    const copilotTools =
      functionTools.length > 0
        ? mapToolsToCopilotFormat(functionTools)
        : undefined;
    const builtInToolFilter = this.getBuiltInToolFilter();
    const toolNames = this.getToolNames(functionTools);

    const { session, shouldDestroyAfterCall, promptToSend } =
      await this.resolveSession({
        options,
        systemMessage,
        copilotTools,
        builtInToolFilter,
        toolNames,
        effectivePrompt,
        streaming: true,
      });

    // Check abort before starting stream
    if (options.abortSignal?.aborted) {
      await session.destroy().catch(() => {});
      throw createAbortError();
    }

    const modelId = this.modelId;
    const streamWarnings = warnings;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        let textPartId: string | undefined;
        let totalInputTokens: number | undefined;
        let totalOutputTokens: number | undefined;
        let cacheReadTokens: number | undefined;
        let cacheWriteTokens: number | undefined;
        let finished = false;
        let hasToolCalls = false;

        const cleanup = () => {
          if (!finished) {
            finished = true;
            if (shouldDestroyAfterCall) {
              session.destroy().catch(() => {});
            }
          }
        };

        // Handle abort
        const onAbort = () => {
          cleanup();
          controller.error(createAbortError());
        };
        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }

        // Emit stream-start
        controller.enqueue({ type: "stream-start", warnings: streamWarnings });

        const unsubscribe = session.on((event) => {
          try {
            switch (event.type) {
              case "assistant.message_delta": {
                const delta = event.data.deltaContent;
                if (delta) {
                  if (!textPartId) {
                    textPartId = randomUUID();
                    controller.enqueue({ type: "text-start", id: textPartId });
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textPartId,
                    delta,
                  });
                }
                break;
              }

              case "assistant.message": {
                // Handle tool requests from the final assistant message
                const toolRequests = (event.data.toolRequests ??
                  []) as CopilotToolRequest[];
                if (toolRequests.length > 0) {
                  hasToolCalls = true;

                  // Close text part if opened before emitting tool calls
                  if (textPartId) {
                    controller.enqueue({
                      type: "text-end",
                      id: textPartId,
                    });
                    textPartId = undefined;
                  }

                  // Emit each tool call
                  for (const req of toolRequests) {
                    const toolCall = mapCopilotToolRequestToContent(req);
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: toolCall.toolCallId,
                      toolName: toolCall.toolName,
                      input: toolCall.input,
                    });
                  }
                }
                break;
              }

              case "assistant.usage": {
                totalInputTokens = event.data.inputTokens;
                totalOutputTokens = event.data.outputTokens;
                cacheReadTokens = event.data.cacheReadTokens;
                cacheWriteTokens = event.data.cacheWriteTokens;
                break;
              }

              case "session.error": {
                cleanup();
                const sessionError = new Error(event.data.message);
                controller.error(sessionError);
                break;
              }

              case "session.idle": {
                // Close text part if still open
                if (textPartId) {
                  controller.enqueue({ type: "text-end", id: textPartId });
                }

                // Emit response metadata
                controller.enqueue({
                  type: "response-metadata",
                  id: randomUUID(),
                  timestamp: new Date(),
                  modelId,
                });

                // Build usage
                const usage: LanguageModelV3Usage = {
                  inputTokens: {
                    total: totalInputTokens,
                    noCache: undefined,
                    cacheRead: cacheReadTokens,
                    cacheWrite: cacheWriteTokens,
                  },
                  outputTokens: {
                    total: totalOutputTokens,
                    text: undefined,
                    reasoning: undefined,
                  },
                };

                // Emit finish with correct finish reason
                const finishReason = hasToolCalls ? "tool-calls" : "stop";
                controller.enqueue({
                  type: "finish",
                  finishReason: {
                    unified: finishReason,
                    raw: finishReason,
                  },
                  usage,
                });

                cleanup();

                if (options.abortSignal) {
                  options.abortSignal.removeEventListener("abort", onAbort);
                }
                unsubscribe();
                controller.close();
                break;
              }
            }
          } catch (error) {
            cleanup();
            controller.error(mapCopilotError(error));
          }
        });

        // Send the prompt to kick off the conversation
        try {
          await session.send({ prompt: promptToSend });
        } catch (error) {
          cleanup();
          if (options.abortSignal) {
            options.abortSignal.removeEventListener("abort", onAbort);
          }
          unsubscribe();
          controller.error(mapCopilotError(error));
        }
      },
      cancel() {
        if (shouldDestroyAfterCall) {
          session.destroy().catch(() => {});
        }
      },
    });

    return {
      stream,
      rawCall: {
        rawPrompt: { systemMessage, prompt: effectivePrompt },
        rawSettings: {
          model: this.modelId,
          streaming: true,
          tools: copilotTools?.map((t) => t.name),
          availableTools: builtInToolFilter.availableTools,
        },
      },
    };
  }
}

function getRequestedToolChoice(options: LanguageModelV3CallOptions): unknown {
  return (options as LanguageModelV3CallOptions & { toolChoice?: unknown })
    .toolChoice;
}

function buildToolChoicePromptInstruction(input: {
  toolChoice: unknown;
  toolNames: string[];
}): string | undefined {
  const { toolChoice, toolNames } = input;

  if (toolChoice === "none") {
    return "Tool usage is disabled for this step. Do not call any tools in this response.";
  }

  if (toolChoice === "required") {
    if (toolNames.length === 0) {
      return undefined;
    }

    return [
      "Tool usage is required for this step.",
      `You must call at least one tool before producing a final text answer. Available tools: ${toolNames.join(", ")}.`,
      "Do not reply with plain text only.",
    ].join(" ");
  }

  if (
    typeof toolChoice === "object" &&
    toolChoice !== null &&
    (toolChoice as { type?: unknown }).type === "tool"
  ) {
    const toolName = (toolChoice as { toolName?: unknown }).toolName;

    if (typeof toolName !== "string" || toolName.length === 0) {
      return undefined;
    }

    return [
      "Tool usage is required for this step.",
      `You must call the tool \"${toolName}\" before producing any final text answer.`,
      "Do not reply with plain text only.",
    ].join(" ");
  }

  return undefined;
}

function createAbortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
