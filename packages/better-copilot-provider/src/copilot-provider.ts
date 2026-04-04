import type { LanguageModelV3 } from "@ai-sdk/provider";
import {
  type FetchFunction,
  withoutTrailingSlash,
  withUserAgentSuffix,
} from "@ai-sdk/provider-utils";
import { OpenAICompatibleChatLanguageModel } from "./chat/openai-compatible-chat-language-model";
import { OpenAIResponsesLanguageModel } from "./responses/openai-responses-language-model";

// Import the version or define it
const VERSION = "0.1.0";

export type OpenaiCompatibleModelId = string;

function parseBody(input: RequestInfo | URL, init?: RequestInit): unknown {
  const body = typeof init?.body === "string" ? init.body : undefined;

  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

function detectCopilotRequestShape(
  input: RequestInfo | URL,
  init?: RequestInit,
): {
  isVision: boolean;
  isAgent: boolean;
} {
  const url = getUrl(input);
  const body = parseBody(input, init);

  if (!body || typeof body !== "object") {
    return { isVision: false, isAgent: false };
  }

  const record = body as Record<string, unknown>;

  if (Array.isArray(record.messages) && url.includes("completions")) {
    const messages = record.messages as Array<Record<string, unknown>>;
    const last = messages[messages.length - 1];
    const isVision = messages.some((msg) => {
      const content = msg.content;
      return (
        Array.isArray(content) &&
        content.some(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            (part as Record<string, unknown>).type === "image_url",
        )
      );
    });

    return {
      isVision,
      isAgent: last?.role !== "user",
    };
  }

  if (Array.isArray(record.input)) {
    const inputParts = record.input as Array<Record<string, unknown>>;
    const last = inputParts[inputParts.length - 1];
    const isVision = inputParts.some((item) => {
      const content = item?.content;
      return (
        Array.isArray(content) &&
        content.some(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            (part as Record<string, unknown>).type === "input_image",
        )
      );
    });

    return {
      isVision,
      isAgent: last?.role !== "user",
    };
  }

  if (Array.isArray(record.messages)) {
    const messages = record.messages as Array<Record<string, unknown>>;
    const last = messages[messages.length - 1];
    const lastContent = Array.isArray(last?.content)
      ? (last.content as Array<Record<string, unknown>>)
      : [];
    const hasNonToolResult = lastContent.some(
      (part) => part?.type !== "tool_result",
    );
    const isVision = messages.some((item) => {
      const content = Array.isArray(item?.content)
        ? (item.content as Array<Record<string, unknown>>)
        : [];

      return content.some((part) => {
        if (part?.type === "image") {
          return true;
        }

        if (part?.type !== "tool_result") {
          return false;
        }

        const nested = Array.isArray(part.content)
          ? (part.content as Array<Record<string, unknown>>)
          : [];
        return nested.some((x) => x?.type === "image");
      });
    });

    return {
      isVision,
      isAgent: !(last?.role === "user" && hasNonToolResult),
    };
  }

  return { isVision: false, isAgent: false };
}

function createCopilotFetch(input: {
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
  debugRequests?: boolean;
}): FetchFunction {
  const base = (input.fetch ?? fetch) as FetchFunction;

  const wrapped = async (request: RequestInfo | URL, init?: RequestInit) => {
    const { isVision, isAgent } = detectCopilotRequestShape(request, init);
    const url = getUrl(request);
    const headers = new Headers(init?.headers);

    headers.delete("x-api-key");
    headers.delete("authorization");

    headers.set("x-initiator", isAgent ? "agent" : "user");
    headers.set("Openai-Intent", "conversation-edits");

    if (isVision) {
      headers.set("Copilot-Vision-Request", "true");
    }

    for (const [key, value] of Object.entries(input.headers ?? {})) {
      headers.set(key, value);
    }

    if (input.apiKey) {
      headers.set("Authorization", `Bearer ${input.apiKey}`);
    }

    if (input.debugRequests) {
      const endpoint = url.includes("/responses")
        ? "responses"
        : url.includes("/chat/completions")
          ? "chat.completions"
          : "other";
      console.log("[better-copilot-provider] request", {
        endpoint,
        initiator: isAgent ? "agent" : "user",
        isVision,
      });
    }

    return base(request, {
      ...init,
      headers,
    });
  };

  return wrapped as FetchFunction;
}

function shouldUseCopilotResponsesApi(modelId: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelId);
  if (!match) return false;
  return Number(match[1]) >= 5 && !modelId.startsWith("gpt-5-mini");
}

export interface OpenaiCompatibleProviderSettings {
  /**
   * API key for authenticating requests.
   */
  apiKey?: string;

  /**
   * Base URL for the OpenAI Compatible API calls.
   */
  baseURL?: string;

  /**
   * Name of the provider.
   */
  name?: string;

  /**
   * Custom headers to include in the requests.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation.
   */
  fetch?: FetchFunction;

  /**
   * Print Copilot request classification (x-initiator) logs.
   */
  debugRequests?: boolean;
}

export interface OpenaiCompatibleProvider {
  (modelId: OpenaiCompatibleModelId): LanguageModelV3;
  auto(modelId: OpenaiCompatibleModelId): LanguageModelV3;
  chat(modelId: OpenaiCompatibleModelId): LanguageModelV3;
  responses(modelId: OpenaiCompatibleModelId): LanguageModelV3;
  languageModel(modelId: OpenaiCompatibleModelId): LanguageModelV3;

  // embeddingModel(modelId: any): EmbeddingModelV2

  // imageModel(modelId: any): ImageModelV2
}

/**
 * Create an OpenAI Compatible provider instance.
 */
export function createOpenaiCompatible(
  options: OpenaiCompatibleProviderSettings = {},
): OpenaiCompatibleProvider {
  const debugRequests =
    options.debugRequests ?? process.env.COPILOT_DEBUG_REQUESTS === "1";

  const baseURL = withoutTrailingSlash(
    options.baseURL ?? "https://api.githubcopilot.com",
  );

  if (!baseURL) {
    throw new Error("baseURL is required");
  }

  // Merge headers: defaults first, then user overrides
  const headers = {
    // Default OpenAI Compatible headers (can be overridden by user)
    ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    ...options.headers,
  };

  const getHeaders = () =>
    withUserAgentSuffix(headers, `ai-sdk/openai-compatible/${VERSION}`);

  const createChatModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.chat`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: createCopilotFetch({ ...options, debugRequests }),
    });
  };

  const createResponsesModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.responses`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: createCopilotFetch({ ...options, debugRequests }),
    });
  };

  const createLanguageModel = (modelId: OpenaiCompatibleModelId) =>
    shouldUseCopilotResponsesApi(modelId)
      ? createResponsesModel(modelId)
      : createChatModel(modelId);

  const provider = function (modelId: OpenaiCompatibleModelId) {
    return createLanguageModel(modelId);
  };

  provider.auto = createLanguageModel;
  provider.languageModel = createLanguageModel;
  provider.chat = createChatModel;
  provider.responses = createResponsesModel;

  return provider as OpenaiCompatibleProvider;
}

// Default OpenAI Compatible provider instance
export const openaiCompatible = createOpenaiCompatible();
