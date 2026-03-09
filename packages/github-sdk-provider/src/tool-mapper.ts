/**
 * Maps Vercel AI SDK V3 tool definitions to Copilot tool format,
 * and maps Copilot tool request events back to AI SDK tool-call content parts.
 *
 * The Copilot CLI expects tools as `{ name, description, parameters }`.
 * The AI SDK provides tools as `LanguageModelV3FunctionTool` with `inputSchema`.
 * Since the AI SDK handles tool execution on its side, we register no-op handlers.
 */
import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider";
import type { CopilotTool } from "./copilot-client";

/**
 * A tool request from the Copilot CLI's `assistant.message` event.
 * Matches the `toolRequests` array shape from session events.
 */
export interface CopilotToolRequest {
	toolCallId: string;
	name: string;
	arguments?: unknown;
	type?: "function" | "custom";
}

/**
 * Map an array of AI SDK function tools to Copilot tool definitions.
 *
 * The Copilot CLI needs a `handler` for each tool, but since the AI SDK
 * manages tool execution itself, we provide a no-op handler that returns
 * a message indicating the call should be handled externally.
 */
export function mapToolsToCopilotFormat(tools: LanguageModelV3FunctionTool[]): CopilotTool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: cleanJsonSchema(tool.inputSchema as Record<string, unknown>),
		handler: async () => {
			// The AI SDK handles tool execution — this handler should not be called
			// in practice because we intercept tool requests at the event level.
			return {
				textResultForLlm: "Tool execution is managed by the AI SDK.",
				resultType: "rejected" as const,
			};
		},
	}));
}

/**
 * Convert a Copilot tool request into AI SDK LanguageModelV3ToolCall content format.
 */
export function mapCopilotToolRequestToContent(request: CopilotToolRequest): {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: string;
} {
	return {
		type: "tool-call",
		toolCallId: request.toolCallId,
		toolName: request.name,
		input:
			typeof request.arguments === "string"
				? request.arguments
				: JSON.stringify(request.arguments ?? {}),
	};
}

/**
 * Clean a JSON schema for Copilot CLI compatibility.
 * Removes `$schema`, `$ref`, `$defs`, `definitions` etc.
 */
function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
	if (typeof schema !== "object" || schema === null) {
		return schema;
	}

	const cleaned = { ...schema };

	// Remove JSON Schema meta-properties
	delete cleaned.$schema;
	delete cleaned.$ref;
	delete cleaned.$defs;
	delete cleaned.definitions;

	// Recursively clean nested schemas
	if (cleaned.properties && typeof cleaned.properties === "object") {
		const cleanedProps: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(cleaned.properties as Record<string, unknown>)) {
			cleanedProps[key] = cleanJsonSchema(value as Record<string, unknown>);
		}
		cleaned.properties = cleanedProps;
	}

	if (cleaned.items && typeof cleaned.items === "object") {
		cleaned.items = cleanJsonSchema(cleaned.items as Record<string, unknown>);
	}

	if (cleaned.additionalProperties && typeof cleaned.additionalProperties === "object") {
		cleaned.additionalProperties = cleanJsonSchema(
			cleaned.additionalProperties as Record<string, unknown>
		);
	}

	for (const key of ["allOf", "anyOf", "oneOf"] as const) {
		const arrayProp = cleaned[key];
		if (Array.isArray(arrayProp)) {
			cleaned[key] = arrayProp.map((item: unknown) =>
				cleanJsonSchema(item as Record<string, unknown>)
			);
		}
	}

	// Ensure type is set for object-like schemas
	if (cleaned.properties && cleaned.type === undefined) {
		cleaned.type = "object";
	}

	return cleaned;
}
