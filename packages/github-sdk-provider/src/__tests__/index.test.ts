import { describe, expect, it } from "vitest";
import { validateAuth } from "../auth";
import {
	createAPICallError,
	createAuthenticationError,
	createTimeoutError,
	getErrorMetadata,
	isAuthenticationError,
	isRetryableError,
	isTimeoutError,
	mapCopilotError,
} from "../error";
import { createGitHubCopilotProvider } from "../github-copilot-provider";
import * as index from "../index";

describe("index exports", () => {
	describe("main export", () => {
		it("should export createGitHubCopilotProvider function", () => {
			expect(index.createGitHubCopilotProvider).toBeDefined();
			expect(typeof index.createGitHubCopilotProvider).toBe("function");
			expect(index.createGitHubCopilotProvider).toBe(createGitHubCopilotProvider);
		});
	});

	describe("auth exports", () => {
		it("should export validateAuth function", () => {
			expect(index.validateAuth).toBeDefined();
			expect(typeof index.validateAuth).toBe("function");
			expect(index.validateAuth).toBe(validateAuth);
		});

		it("should export CopilotAuthStatus type", () => {
			// TypeScript type exports are compile-time only
			type _TestType = index.CopilotAuthStatus;
			expect(true).toBe(true);
		});
	});

	describe("error exports", () => {
		it("should export createAPICallError", () => {
			expect(index.createAPICallError).toBeDefined();
			expect(index.createAPICallError).toBe(createAPICallError);
		});

		it("should export createAuthenticationError", () => {
			expect(index.createAuthenticationError).toBeDefined();
			expect(index.createAuthenticationError).toBe(createAuthenticationError);
		});

		it("should export createTimeoutError", () => {
			expect(index.createTimeoutError).toBeDefined();
			expect(index.createTimeoutError).toBe(createTimeoutError);
		});

		it("should export getErrorMetadata", () => {
			expect(index.getErrorMetadata).toBeDefined();
			expect(index.getErrorMetadata).toBe(getErrorMetadata);
		});

		it("should export isAuthenticationError", () => {
			expect(index.isAuthenticationError).toBeDefined();
			expect(index.isAuthenticationError).toBe(isAuthenticationError);
		});

		it("should export isRetryableError", () => {
			expect(index.isRetryableError).toBeDefined();
			expect(index.isRetryableError).toBe(isRetryableError);
		});

		it("should export isTimeoutError", () => {
			expect(index.isTimeoutError).toBeDefined();
			expect(index.isTimeoutError).toBe(isTimeoutError);
		});

		it("should export mapCopilotError", () => {
			expect(index.mapCopilotError).toBeDefined();
			expect(index.mapCopilotError).toBe(mapCopilotError);
		});

		it("should export CopilotErrorMetadata type", () => {
			type _TestType = index.CopilotErrorMetadata;
			expect(true).toBe(true);
		});
	});

	describe("type exports", () => {
		it("should export GitHubCopilotProvider type", () => {
			type _TestType = index.GitHubCopilotProvider;
			expect(true).toBe(true);
		});

		it("should export CopilotModelInfo type", () => {
			type _TestType = index.CopilotModelInfo;
			expect(true).toBe(true);
		});

		it("should export GitHubCopilotProviderOptions type", () => {
			type _TestType = index.GitHubCopilotProviderOptions;
			expect(true).toBe(true);
		});

		it("should export GitHubCopilotModelSettings type", () => {
			type _TestType = index.GitHubCopilotModelSettings;
			expect(true).toBe(true);
		});
	});

	describe("export completeness", () => {
		it("should export all expected function exports", () => {
			const expectedFunctionExports = [
				"createGitHubCopilotProvider",
				"validateAuth",
				"createAPICallError",
				"createAuthenticationError",
				"createTimeoutError",
				"getErrorMetadata",
				"isAuthenticationError",
				"isRetryableError",
				"isTimeoutError",
				"mapCopilotError",
			];

			const actualFunctionExports = Object.keys(index).filter(
				(key) => typeof (index as Record<string, unknown>)[key] === "function"
			);

			for (const expected of expectedFunctionExports) {
				expect(actualFunctionExports).toContain(expected);
			}
		});

		it("should not have any default export", () => {
			expect((index as Record<string, unknown>).default).toBeUndefined();
		});
	});

	describe("type safety", () => {
		it("should accept valid provider options", () => {
			const validOptions: index.GitHubCopilotProviderOptions = {};
			const provider = index.createGitHubCopilotProvider(validOptions);
			expect(provider).toBeDefined();
		});

		it("should accept provider options with githubToken", () => {
			const options: index.GitHubCopilotProviderOptions = {
				githubToken: "test-token",
			};
			const provider = index.createGitHubCopilotProvider(options);
			expect(provider).toBeDefined();
		});
	});
});
