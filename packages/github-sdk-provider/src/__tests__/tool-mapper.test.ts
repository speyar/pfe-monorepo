import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	type CopilotToolRequest,
	mapCopilotToolRequestToContent,
	mapToolsToCopilotFormat,
} from "../tool-mapper";

describe("mapToolsToCopilotFormat", () => {
	it("should map a single tool with basic schema", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "getWeather",
				description: "Get current weather",
				inputSchema: {
					type: "object",
					properties: {
						location: { type: "string" },
					},
					required: ["location"],
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);

		expect(result).toHaveLength(1);
		const [tool] = result;
		if (!tool) {
			throw new Error("Expected tool mapping result");
		}
		expect(tool.name).toBe("getWeather");
		expect(tool.description).toBe("Get current weather");
		expect(tool.parameters).toEqual({
			type: "object",
			properties: { location: { type: "string" } },
			required: ["location"],
		});
		expect(tool.handler).toBeDefined();
	});

	it("should map multiple tools", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "toolA",
				description: "Tool A",
				inputSchema: { type: "object", properties: {} },
			},
			{
				type: "function",
				name: "toolB",
				description: "Tool B",
				inputSchema: { type: "object", properties: {} },
			},
		];

		const result = mapToolsToCopilotFormat(tools);

		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("toolA");
		expect(result[1]?.name).toBe("toolB");
	});

	it("should remove $schema from input schema", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					$schema: "http://json-schema.org/draft-07/schema#",
					type: "object",
					properties: {},
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);

		expect((result[0]?.parameters as Record<string, unknown> | undefined)?.$schema).toBeUndefined();
	});

	it("should remove $ref and $defs from schema", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					$ref: "#/$defs/Foo",
					$defs: { Foo: { type: "string" } },
					definitions: { Bar: { type: "number" } },
					type: "object",
					properties: {},
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		const params = result[0]?.parameters as Record<string, unknown> | undefined;
		if (!params) {
			throw new Error("Expected tool parameters");
		}

		expect(params.$ref).toBeUndefined();
		expect(params.$defs).toBeUndefined();
		expect(params.definitions).toBeUndefined();
	});

	it("should recursively clean nested schemas in properties", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					type: "object",
					properties: {
						nested: {
							$schema: "remove-me",
							type: "object",
							properties: {
								deep: { $ref: "remove-me-too", type: "string" },
							},
						},
					},
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		const params = result[0]?.parameters as Record<string, unknown> | undefined;
		if (!params) {
			throw new Error("Expected tool parameters");
		}

		const nested = params.properties as Record<
			string,
			{ properties?: Record<string, { type?: string; $ref?: string }>; $schema?: string }
		>;
		expect(nested.nested?.$schema).toBeUndefined();
		expect(nested.nested?.properties?.deep?.$ref).toBeUndefined();
		expect(nested.nested?.properties?.deep?.type).toBe("string");
	});

	it("should clean items schema in arrays", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					type: "object",
					properties: {
						list: {
							type: "array",
							items: { $schema: "remove", type: "string" },
						},
					},
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		const params = result[0]?.parameters as Record<string, unknown> | undefined;
		if (!params) {
			throw new Error("Expected tool parameters");
		}

		const properties = params.properties as Record<
			string,
			{ items?: { type?: string; $schema?: string } }
		>;
		expect(properties.list?.items?.$schema).toBeUndefined();
		expect(properties.list?.items?.type).toBe("string");
	});

	it("should clean additionalProperties schema", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					type: "object",
					properties: {},
					additionalProperties: { $schema: "remove", type: "string" },
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		const params = result[0]?.parameters as Record<string, unknown> | undefined;
		if (!params) {
			throw new Error("Expected tool parameters");
		}

		const additional = params.additionalProperties as
			| { type?: string; $schema?: string }
			| undefined;
		expect(additional?.$schema).toBeUndefined();
		expect(additional?.type).toBe("string");
	});

	it("should clean allOf/anyOf/oneOf schemas", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					type: "object",
					properties: {},
					anyOf: [
						{ $schema: "remove", type: "string" },
						{ $ref: "remove", type: "number" },
					],
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		const params = result[0]?.parameters as Record<string, unknown> | undefined;
		if (!params) {
			throw new Error("Expected tool parameters");
		}

		const anyOf = params.anyOf as Array<{ $schema?: string; $ref?: string }> | undefined;
		expect(anyOf?.[0]?.$schema).toBeUndefined();
		expect(anyOf?.[1]?.$ref).toBeUndefined();
	});

	it("should add type='object' when properties exist but type is missing", () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: {
					properties: { x: { type: "string" } },
				},
			},
		];

		const result = mapToolsToCopilotFormat(tools);

		const params = result[0]?.parameters as { type?: string } | undefined;
		expect(params?.type).toBe("object");
	});

	it("should provide a no-op handler", async () => {
		const tools: LanguageModelV3FunctionTool[] = [
			{
				type: "function",
				name: "test",
				description: "test",
				inputSchema: { type: "object", properties: {} },
			},
		];

		const result = mapToolsToCopilotFormat(tools);
		// ToolHandler expects (args, invocation) — pass both
		const handler = result[0]?.handler;
		if (!handler) {
			throw new Error("Expected tool handler");
		}
		const handlerResult = await handler(
			{} as Record<string, never>,
			{ toolName: "test", arguments: {} } as { toolName: string; arguments: Record<string, never> }
		);

		expect(handlerResult).toEqual({
			textResultForLlm: "Tool execution is managed by the AI SDK.",
			resultType: "rejected",
		});
	});

	it("should handle empty tools array", () => {
		const result = mapToolsToCopilotFormat([]);

		expect(result).toEqual([]);
	});
});

describe("mapCopilotToolRequestToContent", () => {
	it("should map a tool request with string arguments", () => {
		const request: CopilotToolRequest = {
			toolCallId: "call-123",
			name: "getWeather",
			arguments: '{"location":"NYC"}',
		};

		const result = mapCopilotToolRequestToContent(request);

		expect(result).toEqual({
			type: "tool-call",
			toolCallId: "call-123",
			toolName: "getWeather",
			input: '{"location":"NYC"}',
		});
	});

	it("should stringify object arguments", () => {
		const request: CopilotToolRequest = {
			toolCallId: "call-456",
			name: "search",
			arguments: { query: "test" },
		};

		const result = mapCopilotToolRequestToContent(request);

		expect(result).toEqual({
			type: "tool-call",
			toolCallId: "call-456",
			toolName: "search",
			input: '{"query":"test"}',
		});
	});

	it("should default to empty object when arguments are undefined", () => {
		const request: CopilotToolRequest = {
			toolCallId: "call-789",
			name: "noArgs",
		};

		const result = mapCopilotToolRequestToContent(request);

		expect(result).toEqual({
			type: "tool-call",
			toolCallId: "call-789",
			toolName: "noArgs",
			input: "{}",
		});
	});

	it("should default to empty object when arguments are null", () => {
		const request: CopilotToolRequest = {
			toolCallId: "call-000",
			name: "nullArgs",
			arguments: null as unknown,
		};

		const result = mapCopilotToolRequestToContent(request);

		expect(result.input).toBe("{}");
	});
});
