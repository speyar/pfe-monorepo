import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { mapMessages } from "../message-mapper";

describe("mapMessages", () => {
	describe("system messages", () => {
		it("should extract a single system message", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: [{ type: "text", text: "Hello" }] },
			];

			const result = mapMessages(messages);

			expect(result.systemMessage).toBe("You are a helpful assistant.");
			expect(result.prompt).toContain("[user]");
			expect(result.prompt).toContain("Hello");
		});

		it("should concatenate multiple system messages", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "system", content: "First instruction." },
				{ role: "system", content: "Second instruction." },
				{ role: "user", content: [{ type: "text", text: "Go" }] },
			];

			const result = mapMessages(messages);

			expect(result.systemMessage).toBe("First instruction.\n\nSecond instruction.");
		});

		it("should return undefined systemMessage when none present", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "user", content: [{ type: "text", text: "Hi" }] },
			];

			const result = mapMessages(messages);

			expect(result.systemMessage).toBeUndefined();
		});
	});

	describe("user messages", () => {
		it("should serialize a user text message", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "user", content: [{ type: "text", text: "Hello world" }] },
			];

			const result = mapMessages(messages);

			expect(result.prompt).toBe("[user]\nHello world");
		});

		it("should concatenate multiple text parts", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Part one" },
						{ type: "text", text: "Part two" },
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("Part one\nPart two");
		});

		it("should skip non-text parts gracefully", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "user",
					content: [
						{ type: "text", text: "Some text" },
						// Image parts should be skipped
						{
							type: "image",
							image: new Uint8Array([1, 2, 3]),
							mediaType: "image/png",
						} as unknown as LanguageModelV3Message["content"][number],
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("Some text");
		});

		it("should handle empty user message content", () => {
			const messages: LanguageModelV3Message[] = [{ role: "user", content: [] }];

			const result = mapMessages(messages);

			expect(result.prompt).toBe("");
		});
	});

	describe("assistant messages", () => {
		it("should serialize assistant text", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "assistant",
					content: [{ type: "text", text: "I can help with that." }],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toBe("[assistant]\nI can help with that.");
		});

		it("should serialize tool-call parts", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "call-1",
							toolName: "getWeather",
							input: '{"location":"NYC"}',
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[tool-call: getWeather(");
			expect(result.prompt).toContain("NYC");
		});

		it("should serialize non-string tool-call input as JSON", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "call-2",
							toolName: "search",
							input: {
								query: "test",
							} as unknown as LanguageModelV3Message["content"][number]["input"],
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain('[tool-call: search({"query":"test"})]');
		});

		it("should handle mixed text and tool-call parts", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me check." },
						{
							type: "tool-call",
							toolCallId: "call-3",
							toolName: "lookup",
							input: "{}",
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("Let me check.");
			expect(result.prompt).toContain("[tool-call: lookup({})]");
		});
	});

	describe("tool result messages", () => {
		it("should serialize text tool results", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-1",
							toolName: "getWeather",
							output: { type: "text", value: "Sunny, 72°F" },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[tool-result]");
			expect(result.prompt).toContain("[getWeather:call-1] Sunny, 72°F");
		});

		it("should serialize JSON tool results", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-2",
							toolName: "search",
							output: { type: "json", value: { results: [1, 2, 3] } },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[search:call-2]");
			expect(result.prompt).toContain('{"results":[1,2,3]}');
		});

		it("should serialize execution-denied tool results", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-3",
							toolName: "dangerousTool",
							output: { type: "execution-denied", reason: "User denied" },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[dangerousTool:call-3] User denied");
		});

		it("should serialize error-text tool results", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-4",
							toolName: "failTool",
							output: { type: "error-text", value: "Something went wrong" },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[failTool:call-4] Something went wrong");
		});

		it("should serialize error-json tool results", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-5",
							toolName: "errorTool",
							output: { type: "error-json", value: { code: "ERR", detail: "Bad" } },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[errorTool:call-5]");
			expect(result.prompt).toContain('{"code":"ERR","detail":"Bad"}');
		});

		it("should handle execution-denied without reason", () => {
			const messages: LanguageModelV3Message[] = [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-6",
							toolName: "blocked",
							output: { type: "execution-denied" },
						},
					],
				},
			];

			const result = mapMessages(messages);

			expect(result.prompt).toContain("[blocked:call-6] [execution denied]");
		});
	});

	describe("multi-turn conversations", () => {
		it("should serialize a full conversation with role markers", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "system", content: "Be concise." },
				{ role: "user", content: [{ type: "text", text: "Hi" }] },
				{ role: "assistant", content: [{ type: "text", text: "Hello!" }] },
				{ role: "user", content: [{ type: "text", text: "How are you?" }] },
			];

			const result = mapMessages(messages);

			expect(result.systemMessage).toBe("Be concise.");
			expect(result.prompt).toContain("[user]\nHi");
			expect(result.prompt).toContain("[assistant]\nHello!");
			expect(result.prompt).toContain("[user]\nHow are you?");
		});

		it("should separate conversation turns with double newlines", () => {
			const messages: LanguageModelV3Message[] = [
				{ role: "user", content: [{ type: "text", text: "A" }] },
				{ role: "assistant", content: [{ type: "text", text: "B" }] },
			];

			const result = mapMessages(messages);

			expect(result.prompt).toBe("[user]\nA\n\n[assistant]\nB");
		});
	});

	describe("edge cases", () => {
		it("should handle empty messages array", () => {
			const result = mapMessages([]);

			expect(result.systemMessage).toBeUndefined();
			expect(result.prompt).toBe("");
		});

		it("should handle only system messages", () => {
			const messages: LanguageModelV3Message[] = [{ role: "system", content: "Instructions only" }];

			const result = mapMessages(messages);

			expect(result.systemMessage).toBe("Instructions only");
			expect(result.prompt).toBe("");
		});
	});
});
