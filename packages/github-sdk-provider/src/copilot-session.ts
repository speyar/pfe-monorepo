/**
 * Minimal CopilotSession implementation.
 *
 * Wraps a session ID + JSON-RPC connection and provides the methods our
 * provider actually uses: `send()`, `sendAndWait()`, `on()`, `destroy()`.
 *
 * This replaces the `CopilotSession` class from `@github/copilot-sdk`.
 */
import type { MessageConnection } from "vscode-jsonrpc/node.js";

// ── Event types ──────────────────────────────────────────────────────

export interface SessionEventMap {
  "assistant.message_delta": { deltaContent: string };
  "assistant.message": {
    content: string;
    messageId: string;
    toolRequests?: Array<{
      toolCallId: string;
      name: string;
      arguments?: unknown;
      type?: "function" | "custom";
    }>;
  };
  "assistant.usage": {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  "session.error": { message: string; stack?: string };
  "session.idle": Record<string, never>;
}

export type SessionEventType = keyof SessionEventMap;

export type SessionEvent = {
  [K in SessionEventType]: {
    type: K;
    data: SessionEventMap[K];
  };
}[SessionEventType];

/** A wildcard event handler that receives every event. */
export type WildcardEventHandler = (event: SessionEvent) => void;

// ── Session class ────────────────────────────────────────────────────

export class CopilotSession {
  readonly sessionId: string;
  private readonly connection: MessageConnection;
  private eventHandlers = new Set<WildcardEventHandler>();

  constructor(sessionId: string, connection: MessageConnection) {
    this.sessionId = sessionId;
    this.connection = connection;
  }

  // ── Public API used by our provider ──────────────────────────────

  /**
   * Fire-and-forget send. Returns the message ID.
   * Events (deltas, final message, usage, idle) arrive via `on()`.
   */
  async send(options: { prompt: string }): Promise<string> {
    const response = (await this.connection.sendRequest("session.send", {
      sessionId: this.sessionId,
      prompt: options.prompt,
    })) as { messageId: string };
    return response.messageId;
  }

  /**
   * Send and block until the session becomes idle (or errors / times out).
   * Returns the final `assistant.message` event, or undefined.
   */
  async sendAndWait(
    options: { prompt: string },
    timeout?: number,
  ): Promise<Extract<SessionEvent, { type: "assistant.message" }> | undefined> {
    const effectiveTimeout = timeout ?? 60_000;

    let resolveIdle!: () => void;
    let rejectWithError!: (err: Error) => void;

    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    let lastAssistantMessage:
      | Extract<SessionEvent, { type: "assistant.message" }>
      | undefined;
    let firstAssistantMessageWithToolRequests:
      | Extract<SessionEvent, { type: "assistant.message" }>
      | undefined;

    const unsubscribe = this.on((event) => {
      if (event.type === "assistant.message") {
        const assistantMessage = event as Extract<
          SessionEvent,
          { type: "assistant.message" }
        >;
        lastAssistantMessage = assistantMessage;

        if (
          !firstAssistantMessageWithToolRequests &&
          Array.isArray(assistantMessage.data.toolRequests) &&
          assistantMessage.data.toolRequests.length > 0
        ) {
          firstAssistantMessageWithToolRequests = assistantMessage;
          resolveIdle();
        }
      } else if (event.type === "session.idle") {
        resolveIdle();
      } else if (event.type === "session.error") {
        const data = (event as Extract<SessionEvent, { type: "session.error" }>)
          .data;
        const error = new Error(data.message);
        if (data.stack) error.stack = data.stack;
        rejectWithError(error);
      }
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.send(options);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Timeout after ${effectiveTimeout}ms waiting for session.idle`,
              ),
            ),
          effectiveTimeout,
        );
      });

      await Promise.race([idlePromise, timeoutPromise]);
      return firstAssistantMessageWithToolRequests ?? lastAssistantMessage;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      unsubscribe();
    }
  }

  /**
   * Subscribe to all session events. Returns an unsubscribe function.
   */
  on(handler: WildcardEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /**
   * Destroy this session on the server side and clear local handlers.
   */
  async destroy(): Promise<void> {
    await this.connection.sendRequest("session.destroy", {
      sessionId: this.sessionId,
    });
    this.eventHandlers.clear();
  }

  // ── Internal: called by CopilotClient when it receives session.event ─

  /** @internal Dispatch an event from the JSON-RPC notification to handlers. */
  _dispatchEvent(event: { type: string; data?: unknown }): void {
    const typed = event as SessionEvent;
    for (const handler of this.eventHandlers) {
      try {
        handler(typed);
      } catch {
        // swallow handler errors like the original SDK
      }
    }
  }
}
