import { NoSuchModelError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { GitHubCopilotLanguageModel } from "../github-copilot-language-model";
import { createGitHubCopilotProvider } from "../github-copilot-provider";

describe("createGitHubCopilotProvider", () => {
	it("should create a provider function", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider).toBe("function");
	});

	it("should have specificationVersion v3", () => {
		const provider = createGitHubCopilotProvider();
		expect(provider.specificationVersion).toBe("v3");
	});

	it("should have languageModel method", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider.languageModel).toBe("function");
	});

	it("should have chat method", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider.chat).toBe("function");
	});

	it("should have listModels method", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider.listModels).toBe("function");
	});

	it("should have validateAuth method", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider.validateAuth).toBe("function");
	});

	it("should have cleanup method", () => {
		const provider = createGitHubCopilotProvider();
		expect(typeof provider.cleanup).toBe("function");
	});

	it("should create GitHubCopilotLanguageModel instance when called", () => {
		const provider = createGitHubCopilotProvider();
		const model = provider("gpt-4.1");
		expect(model).toBeInstanceOf(GitHubCopilotLanguageModel);
	});

	it("should pass model ID to language model", () => {
		const provider = createGitHubCopilotProvider();
		const model = provider("gpt-4.1");
		expect(model.modelId).toBe("gpt-4.1");
	});

	it("should use default model when empty string passed", () => {
		const provider = createGitHubCopilotProvider();
		const model = provider("");
		expect(model.modelId).toBe("gpt-4.1");
	});

	it("should use custom default model from options", () => {
		const provider = createGitHubCopilotProvider({ defaultModel: "claude-sonnet-4" });
		const model = provider("");
		expect(model.modelId).toBe("claude-sonnet-4");
	});

	it("should throw error when called with new keyword", () => {
		const provider = createGitHubCopilotProvider();
		expect(() => {
			// @ts-expect-error Testing error case
			new provider("gpt-4.1");
		}).toThrow("The provider function cannot be called with the new keyword.");
	});

	describe("languageModel method", () => {
		it("should create same type of model as provider function", () => {
			const provider = createGitHubCopilotProvider();
			const model1 = provider("gpt-4.1");
			const model2 = provider.languageModel("gpt-4.1");

			expect(model1.constructor).toBe(model2.constructor);
			expect(model1.modelId).toBe(model2.modelId);
		});
	});

	describe("chat method", () => {
		it("should create same type of model as provider function", () => {
			const provider = createGitHubCopilotProvider();
			const model1 = provider("gpt-4.1");
			const model2 = provider.chat("gpt-4.1");

			expect(model1.constructor).toBe(model2.constructor);
			expect(model1.modelId).toBe(model2.modelId);
		});
	});

	describe("embeddingModel", () => {
		it("should throw NoSuchModelError", () => {
			const provider = createGitHubCopilotProvider();
			expect(() => {
				provider.embeddingModel("text-embedding-3-small");
			}).toThrow(NoSuchModelError);
		});

		it("should include model ID in error", () => {
			const provider = createGitHubCopilotProvider();
			try {
				provider.embeddingModel("text-embedding-3-small");
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(NoSuchModelError);
				expect((error as NoSuchModelError).modelId).toBe("text-embedding-3-small");
				expect((error as NoSuchModelError).modelType).toBe("embeddingModel");
			}
		});
	});

	describe("imageModel", () => {
		it("should throw NoSuchModelError", () => {
			const provider = createGitHubCopilotProvider();
			expect(() => {
				provider.imageModel("dall-e-3");
			}).toThrow(NoSuchModelError);
		});

		it("should include model ID in error", () => {
			const provider = createGitHubCopilotProvider();
			try {
				provider.imageModel("dall-e-3");
				expect.unreachable("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(NoSuchModelError);
				expect((error as NoSuchModelError).modelId).toBe("dall-e-3");
				expect((error as NoSuchModelError).modelType).toBe("imageModel");
			}
		});
	});

	describe("model properties", () => {
		it("should set provider to github-copilot", () => {
			const provider = createGitHubCopilotProvider();
			const model = provider("gpt-4.1");
			expect(model.provider).toBe("github-copilot");
		});

		it("should set specificationVersion to v3", () => {
			const provider = createGitHubCopilotProvider();
			const model = provider("gpt-4.1");
			expect(model.specificationVersion).toBe("v3");
		});
	});
});
