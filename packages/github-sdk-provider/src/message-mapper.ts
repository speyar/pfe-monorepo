/**
 * Maps Vercel AI SDK LanguageModelV3 messages to the format expected by
 * the GitHub Copilot SDK.
 *
 * Strategy: Extract system messages for session-level config, then flatten
 * remaining user/assistant turns into a single prompt string with role markers.
 * The Copilot SDK's `sendAndWait({ prompt })` only accepts a single string,
 * so we serialize the conversation history into a marked-up format.
 */
import type { LanguageModelV3Message, LanguageModelV3ToolResultOutput } from "@ai-sdk/provider";

export interface MappedPrompt {
	/**
	 * Combined system message content for the session's systemMessage config.
	 * Undefined when no system messages are present.
	 */
	systemMessage: string | undefined;

	/**
	 * Flattened user/assistant conversation serialized as a single prompt string.
	 */
	prompt: string;
}

/**
 * Convert AI SDK messages into a system message and a flattened prompt string.
 *
 * System messages are extracted and joined (multiple system messages are
 * concatenated with newlines). User and assistant messages are serialized
 * with `[user]` / `[assistant]` markers so the model can reconstruct
 * conversational context from a single prompt.
 */
export function mapMessages(messages: LanguageModelV3Message[]): MappedPrompt {
	const systemParts: string[] = [];
	const conversationParts: string[] = [];

	for (const message of messages) {
		switch (message.role) {
			case "system": {
				systemParts.push(message.content);
				break;
			}

			case "user": {
				const text = extractUserText(message);
				if (text) {
					conversationParts.push(`[user]\n${text}`);
				}
				break;
			}

			case "assistant": {
				const text = extractAssistantText(message);
				if (text) {
					conversationParts.push(`[assistant]\n${text}`);
				}
				break;
			}

			case "tool": {
				// Serialize tool results into the conversation so the model
				// can see previous tool execution output in multi-turn flows.
				const toolText = extractToolResultText(message);
				if (toolText) {
					conversationParts.push(`[tool-result]\n${toolText}`);
				}
				break;
			}
		}
	}

	return {
		systemMessage: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
		prompt: conversationParts.join("\n\n"),
	};
}

/**
 * Extract plain text from a user message's content parts.
 * Images and file parts are skipped (Copilot SDK doesn't support them via prompt).
 */
function extractUserText(message: LanguageModelV3Message & { role: "user" }): string {
	const parts: string[] = [];

	for (const part of message.content) {
		switch (part.type) {
			case "text": {
				parts.push(part.text);
				break;
			}
			// "image", "file", etc. — not supported via single-prompt interface
		}
	}

	return parts.join("\n");
}

/**
 * Extract plain text from an assistant message's content parts.
 * Tool calls are serialized so the model can see them in multi-turn context.
 */
function extractAssistantText(message: LanguageModelV3Message & { role: "assistant" }): string {
	const parts: string[] = [];

	for (const part of message.content) {
		switch (part.type) {
			case "text": {
				parts.push(part.text);
				break;
			}
			case "tool-call": {
				// Serialize tool calls so the model knows what was requested
				parts.push(
					`[tool-call: ${part.toolName}(${typeof part.input === "string" ? part.input : JSON.stringify(part.input)})]`
				);
				break;
			}
			// "reasoning" — not serialized into prompt
		}
	}

	return parts.join("\n");
}

/**
 * Extract text from a tool result message.
 * Serializes each tool result so the model can see the output in multi-turn context.
 */
function extractToolResultText(message: LanguageModelV3Message & { role: "tool" }): string {
	const parts: string[] = [];

	for (const part of message.content) {
		if (part.type === "tool-result") {
			const resultText = serializeToolResultOutput(part.output);
			parts.push(`[${part.toolName}:${part.toolCallId}] ${resultText}`);
		}
	}

	return parts.join("\n");
}

/**
 * Serialize a V3 ToolResultOutput union into a plain string for prompt inclusion.
 */
function serializeToolResultOutput(output: LanguageModelV3ToolResultOutput): string {
	switch (output.type) {
		case "text":
		case "error-text":
			return output.value;
		case "json":
		case "error-json":
			return JSON.stringify(output.value);
		case "execution-denied":
			return output.reason ?? "[execution denied]";
		default:
			return JSON.stringify(output);
	}
}
