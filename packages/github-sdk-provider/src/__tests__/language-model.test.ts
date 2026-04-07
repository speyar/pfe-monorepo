import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
} from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubCopilotLanguageModel } from "../github-copilot-language-model";

// Mock the client-manager module
vi.mock("../client-manager", () => ({
  CopilotClientManager: vi.fn().mockImplementation(() => ({
    getClient: vi.fn(),
    stop: vi.fn(),
  })),
}));

// Mock the message-mapper module
vi.mock("../message-mapper", () => ({
  mapMessages: vi.fn().mockReturnValue({
    systemMessage: undefined,
    prompt: "Test prompt",
  }),
}));

// Mock the tool-mapper module
vi.mock("../tool-mapper", () => ({
  mapToolsToCopilotFormat: vi.fn().mockReturnValue([]),
  mapCopilotToolRequestToContent: vi.fn().mockImplementation((req: unknown) => {
    const request = req as {
      toolCallId: string;
      name: string;
      arguments?: unknown;
    };
    return {
      type: "tool-call" as const,
      toolCallId: request.toolCallId,
      toolName: request.name,
      input:
        typeof request.arguments === "string"
          ? request.arguments
          : JSON.stringify(request.arguments ?? {}),
    };
  }),
}));

import { CopilotClientManager } from "../client-manager";
import { mapMessages } from "../message-mapper";
import { mapToolsToCopilotFormat } from "../tool-mapper";

type StreamPartLike = {
  type: string;
  delta?: string;
  finishReason?: unknown;
  toolName?: string;
  input?: string;
  usage?: unknown;
  modelId?: string;
  id?: string;
  timestamp?: unknown;
  warnings?: unknown[];
};

describe("GitHubCopilotLanguageModel", () => {
  let model: GitHubCopilotLanguageModel;
  let mockClientManager: {
    getClient: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mockClient: {
    createSession: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mockSession: {
    sendAndWait: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSession = {
      sendAndWait: vi.fn(),
      send: vi.fn(),
      on: vi.fn().mockReturnValue(vi.fn()), // returns unsubscribe
      destroy: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    mockClient = {
      createSession: vi.fn().mockResolvedValue(mockSession),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    mockClientManager = {
      getClient: vi.fn().mockResolvedValue(mockClient),
      stop: vi.fn().mockResolvedValue(undefined),
    };

    // Override the mock constructor to return our mock
    vi.mocked(CopilotClientManager).mockImplementation(() => mockClientManager);

    vi.mocked(mapMessages).mockReturnValue({
      systemMessage: undefined,
      prompt: "Test prompt",
    });

    vi.mocked(mapToolsToCopilotFormat).mockReturnValue([]);

    model = new GitHubCopilotLanguageModel({
      modelId: "gpt-4.1",
      clientManager: mockClientManager as unknown as CopilotClientManager,
      providerOptions: {},
    });
  });

  describe("constructor", () => {
    it("should initialize with correct properties", () => {
      expect(model.modelId).toBe("gpt-4.1");
      expect(model.provider).toBe("github-copilot");
      expect(model.specificationVersion).toBe("v3");
      expect(model.defaultObjectGenerationMode).toBeUndefined();
      expect(model.supportsImageUrls).toBe(false);
      expect(model.supportsStructuredOutputs).toBe(false);
    });
  });

  describe("doGenerate", () => {
    const defaultPrompt: LanguageModelV3CallOptions["prompt"] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];

    it("should disable built-in CLI tools by default", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          availableTools: [],
        }),
      );
    });

    it("should keep external AI SDK tools while built-ins are disabled", async () => {
      const mappedTool = {
        name: "getWeather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
        handler: vi.fn(),
      };
      vi.mocked(mapToolsToCopilotFormat).mockReturnValue([
        mappedTool as unknown as ReturnType<
          typeof mapToolsToCopilotFormat
        >[number],
      ]);

      const externalTool: LanguageModelV3FunctionTool = {
        type: "function",
        name: "getWeather",
        description: "Get weather",
        inputSchema: { type: "object", properties: {} },
      };

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        tools: [externalTool],
      });

      expect(mapToolsToCopilotFormat).toHaveBeenCalledWith([externalTool]);
      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          availableTools: [],
          tools: [mappedTool],
        }),
      );
    });

    it("should pass allow-listed built-in CLI tools from provider options", async () => {
      model = new GitHubCopilotLanguageModel({
        modelId: "gpt-4.1",
        clientManager: mockClientManager as unknown as CopilotClientManager,
        providerOptions: {
          builtInTools: ["glob", " grep ", "glob", ""],
        },
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          availableTools: ["glob", "grep"],
        }),
      );
    });

    it("should allow all built-in CLI tools when configured", async () => {
      model = new GitHubCopilotLanguageModel({
        modelId: "gpt-4.1",
        clientManager: mockClientManager as unknown as CopilotClientManager,
        providerOptions: {
          builtInTools: "all",
        },
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      const createSessionArg = mockClient.createSession.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(createSessionArg).toBeDefined();
      expect(createSessionArg && "availableTools" in createSessionArg).toBe(
        false,
      );
    });

    it("should generate text successfully", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: {
          content: "Hello, world!",
          messageId: "msg-123",
          toolRequests: [],
        },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Hello, world!",
      });
      expect(result.finishReason).toEqual({ unified: "stop", raw: "stop" });
      expect(result.response?.id).toBe("msg-123");
      expect(result.response?.modelId).toBe("gpt-4.1");
    });

    it("should call mapMessages with the prompt", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mapMessages).toHaveBeenCalledWith(defaultPrompt);
    });

    it("should create session with correct config", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4.1",
          streaming: false,
        }),
      );
    });

    it("should pass system message to session config", async () => {
      vi.mocked(mapMessages).mockReturnValue({
        systemMessage: "Be helpful",
        prompt: "Hello",
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Sure!", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: { mode: "append", content: "Be helpful" },
        }),
      );
    });

    it("should not pass systemMessage when none present", async () => {
      vi.mocked(mapMessages).mockReturnValue({
        systemMessage: undefined,
        prompt: "Hello",
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Hi!", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: undefined,
        }),
      );
    });

    it("should handle empty response", async () => {
      mockSession.sendAndWait.mockResolvedValue(undefined);

      const result = await model.doGenerate({ prompt: defaultPrompt });

      // No text content, empty array
      expect(result.content).toHaveLength(0);
      expect(result.finishReason).toEqual({ unified: "stop", raw: "stop" });
    });

    it("should handle response with empty content", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "", messageId: "msg-1", toolRequests: [] },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.content).toHaveLength(0);
    });

    it("should return unknown usage for non-streaming", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Test", messageId: "msg-1", toolRequests: [] },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.usage).toEqual({
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
      });
    });

    it("should destroy session after successful call", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Done", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({ prompt: defaultPrompt });

      expect(mockSession.destroy).toHaveBeenCalled();
    });

    it("should destroy session even after error", async () => {
      mockSession.sendAndWait.mockRejectedValue(new Error("Network fail"));

      await expect(
        model.doGenerate({ prompt: defaultPrompt }),
      ).rejects.toThrow();

      expect(mockSession.destroy).toHaveBeenCalled();
    });

    it("should emit warning for JSON response format", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: {
          content: '{"key":"value"}',
          messageId: "msg-1",
          toolRequests: [],
        },
      });

      const result = await model.doGenerate({
        prompt: defaultPrompt,
        responseFormat: { type: "json" },
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual(
        expect.objectContaining({
          type: "unsupported",
          feature: "responseFormat",
        }),
      );
    });

    it("should handle tool requests in response", async () => {
      const { mapCopilotToolRequestToContent } = await import("../tool-mapper");
      vi.mocked(mapCopilotToolRequestToContent).mockReturnValue({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "getWeather",
        input: '{"location":"NYC"}',
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: {
          content: "",
          messageId: "msg-1",
          toolRequests: [
            {
              toolCallId: "call-1",
              name: "getWeather",
              arguments: '{"location":"NYC"}',
            },
          ],
        },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "getWeather",
        input: '{"location":"NYC"}',
      });
      expect(result.finishReason).toEqual({
        unified: "tool-calls",
        raw: "tool-calls",
      });
    });

    it("should include both text and tool calls in content", async () => {
      const { mapCopilotToolRequestToContent } = await import("../tool-mapper");
      vi.mocked(mapCopilotToolRequestToContent).mockReturnValue({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        input: "{}",
      });

      mockSession.sendAndWait.mockResolvedValue({
        data: {
          content: "Let me search for that.",
          messageId: "msg-1",
          toolRequests: [
            { toolCallId: "call-1", name: "search", arguments: {} },
          ],
        },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Let me search for that.",
      });
      expect(result.content[1]).toEqual(
        expect.objectContaining({ type: "tool-call" }),
      );
      expect(result.finishReason).toEqual({
        unified: "tool-calls",
        raw: "tool-calls",
      });
    });

    it("should throw on pre-aborted signal", async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        model.doGenerate({
          prompt: defaultPrompt,
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow("Request aborted");
    });

    it("should include rawCall in response", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Test", messageId: "msg-1", toolRequests: [] },
      });

      const result = await model.doGenerate({ prompt: defaultPrompt });

      expect(result.rawCall.rawPrompt).toEqual({
        systemMessage: undefined,
        prompt: "Test prompt",
      });
      expect(result.rawCall.rawSettings).toEqual(
        expect.objectContaining({
          model: "gpt-4.1",
          streaming: false,
        }),
      );
    });

    it("should reuse session when conversationId is provided", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-1",
          },
        },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-1",
          },
        },
      });

      expect(mockClient.createSession).toHaveBeenCalledTimes(1);
      expect(mockSession.destroy).not.toHaveBeenCalled();
      expect(mockSession.sendAndWait).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ prompt: "Test prompt" }),
        expect.any(Number),
      );
      expect(mockSession.sendAndWait).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ prompt: "Test prompt" }),
        expect.any(Number),
      );
    });

    it("should send only incremental prompt content on reused session", async () => {
      vi.mocked(mapMessages)
        .mockReturnValueOnce({
          systemMessage: undefined,
          prompt: "Line A\nLine B",
        })
        .mockReturnValueOnce({
          systemMessage: undefined,
          prompt: "Line A\nLine B\nLine C",
        });

      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-inc",
          },
        },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-inc",
          },
        },
      });

      expect(mockSession.sendAndWait).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ prompt: "Line A\nLine B" }),
        expect.any(Number),
      );
      expect(mockSession.sendAndWait).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ prompt: "Line C" }),
        expect.any(Number),
      );
    });

    it("should not reuse session when reuseSession is false", async () => {
      mockSession.sendAndWait.mockResolvedValue({
        data: { content: "Response", messageId: "msg-1", toolRequests: [] },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-2",
            reuseSession: false,
          },
        },
      });

      await model.doGenerate({
        prompt: defaultPrompt,
        providerOptions: {
          "github-copilot": {
            conversationId: "conv-2",
            reuseSession: false,
          },
        },
      });

      expect(mockClient.createSession).toHaveBeenCalledTimes(2);
      expect(mockSession.destroy).toHaveBeenCalledTimes(2);
    });
  });

  describe("doStream", () => {
    const defaultPrompt: LanguageModelV3CallOptions["prompt"] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];

    it("should allow per-model override for built-in tool filtering", async () => {
      model = new GitHubCopilotLanguageModel({
        modelId: "gpt-4.1",
        clientManager: mockClientManager as unknown as CopilotClientManager,
        providerOptions: {
          builtInTools: "none",
        },
        modelSettings: {
          builtInTools: ["glob"],
        },
      });

      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({ type: "session.idle", data: {} });
      });

      await model.doStream({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          availableTools: ["glob"],
        }),
      );
    });

    it("should return a stream and rawCall", async () => {
      // Simulate the session.on pattern: callback receives events
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn(); // unsubscribe
      });
      mockSession.send.mockImplementation(async () => {
        // Simulate events being fired
        eventCallback({
          type: "assistant.message_delta",
          data: { deltaContent: "Hi!" },
        });
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({ prompt: defaultPrompt });

      expect(result.stream).toBeDefined();
      expect(result.rawCall).toBeDefined();
      expect(result.rawCall.rawSettings).toEqual(
        expect.objectContaining({
          model: "gpt-4.1",
          streaming: true,
        }),
      );
    });

    it("should create session with streaming enabled", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({ type: "session.idle", data: {} });
      });

      await model.doStream({ prompt: defaultPrompt });

      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4.1",
          streaming: true,
        }),
      );
    });

    it("should stream text deltas", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({
          type: "assistant.message_delta",
          data: { deltaContent: "Hello" },
        });
        eventCallback({
          type: "assistant.message_delta",
          data: { deltaContent: ", world!" },
        });
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({ prompt: defaultPrompt });
      const streamParts: StreamPartLike[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamParts.push(value);
      }

      // stream-start, text-start, 2 text-deltas, text-end, response-metadata, finish
      expect(streamParts[0]).toEqual(
        expect.objectContaining({ type: "stream-start" }),
      );

      const textStart = streamParts.find((p) => p.type === "text-start");
      expect(textStart).toBeDefined();

      const textDeltas = streamParts.filter((p) => p.type === "text-delta");
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]?.delta).toBe("Hello");
      expect(textDeltas[1]?.delta).toBe(", world!");

      const textEnd = streamParts.find((p) => p.type === "text-end");
      expect(textEnd).toBeDefined();

      const finish = streamParts.find((p) => p.type === "finish");
      expect(finish).toBeDefined();
      expect(finish?.finishReason).toEqual({ unified: "stop", raw: "stop" });
    });

    it("should stream tool calls from assistant.message event", async () => {
      const { mapCopilotToolRequestToContent } = await import("../tool-mapper");
      vi.mocked(mapCopilotToolRequestToContent).mockReturnValue({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "getWeather",
        input: '{"location":"NYC"}',
      });

      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({
          type: "assistant.message",
          data: {
            content: "",
            messageId: "msg-1",
            toolRequests: [
              {
                toolCallId: "call-1",
                name: "getWeather",
                arguments: '{"location":"NYC"}',
              },
            ],
          },
        });
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({ prompt: defaultPrompt });
      const streamParts: StreamPartLike[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamParts.push(value);
      }

      const toolCallPart = streamParts.find((p) => p.type === "tool-call");
      expect(toolCallPart).toBeDefined();
      expect(toolCallPart?.toolName).toBe("getWeather");
      expect(toolCallPart?.input).toBe('{"location":"NYC"}');

      const finish = streamParts.find((p) => p.type === "finish");
      expect(finish?.finishReason).toEqual({
        unified: "tool-calls",
        raw: "tool-calls",
      });
    });

    it("should include usage from assistant.usage event", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({
          type: "assistant.message_delta",
          data: { deltaContent: "Test" },
        });
        eventCallback({
          type: "assistant.usage",
          data: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 20,
            cacheWriteTokens: 10,
          },
        });
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({ prompt: defaultPrompt });
      const streamParts: StreamPartLike[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamParts.push(value);
      }

      const finish = streamParts.find((p) => p.type === "finish");
      expect(finish?.usage).toEqual({
        inputTokens: {
          total: 100,
          noCache: undefined,
          cacheRead: 20,
          cacheWrite: 10,
        },
        outputTokens: {
          total: 50,
          text: undefined,
          reasoning: undefined,
        },
      });
    });

    it("should handle session.error event", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({
          type: "session.error",
          data: { message: "Something went wrong" },
        });
      });

      const result = await model.doStream({ prompt: defaultPrompt });
      const reader = result.stream.getReader();

      // Read until error
      const parts: StreamPartLike[] = [];
      await expect(async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
        }
      }).rejects.toThrow("Something went wrong");
    });

    it("should throw on pre-aborted signal", async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        model.doStream({
          prompt: defaultPrompt,
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow("Request aborted");
    });

    it("should handle send error", async () => {
      mockSession.on.mockReturnValue(vi.fn());
      mockSession.send.mockRejectedValue(new Error("Send failed"));

      const result = await model.doStream({ prompt: defaultPrompt });
      const reader = result.stream.getReader();

      await expect(async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }).rejects.toThrow();
    });

    it("should emit response-metadata before finish", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({
          type: "assistant.message_delta",
          data: { deltaContent: "Test" },
        });
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({ prompt: defaultPrompt });
      const streamParts: StreamPartLike[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamParts.push(value);
      }

      const metadataIdx = streamParts.findIndex(
        (p) => p.type === "response-metadata",
      );
      const finishIdx = streamParts.findIndex((p) => p.type === "finish");

      expect(metadataIdx).toBeGreaterThan(-1);
      expect(finishIdx).toBeGreaterThan(metadataIdx);

      const metadata = streamParts[metadataIdx];
      expect(metadata?.modelId).toBe("gpt-4.1");
      expect(metadata?.id).toBeDefined();
      expect(metadata?.timestamp).toBeDefined();
    });

    it("should emit warning for JSON response format", async () => {
      let eventCallback: (event: unknown) => void;
      mockSession.on.mockImplementation((cb: (event: unknown) => void) => {
        eventCallback = cb;
        return vi.fn();
      });
      mockSession.send.mockImplementation(async () => {
        eventCallback({ type: "session.idle", data: {} });
      });

      const result = await model.doStream({
        prompt: defaultPrompt,
        responseFormat: { type: "json" },
      });

      const streamParts: StreamPartLike[] = [];
      const reader = result.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamParts.push(value);
      }

      const streamStart = streamParts.find((p) => p.type === "stream-start");
      expect(streamStart?.warnings).toHaveLength(1);
      expect(streamStart?.warnings?.[0]).toEqual(
        expect.objectContaining({
          type: "unsupported",
          feature: "responseFormat",
        }),
      );
    });
  });
});
