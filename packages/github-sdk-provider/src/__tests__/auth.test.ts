import { LoadAPIKeyError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { validateAuth } from "../auth";
import type { CopilotClient, GetAuthStatusResponse } from "../copilot-client";

/**
 * Create a minimal mock CopilotClient with a stubbed getAuthStatus method.
 */
function createMockClient(statusOrError: GetAuthStatusResponse | Error): CopilotClient {
	return {
		getAuthStatus:
			statusOrError instanceof Error
				? vi.fn().mockRejectedValue(statusOrError)
				: vi.fn().mockResolvedValue(statusOrError),
	} as unknown as CopilotClient;
}

describe("validateAuth", () => {
	it("should return auth status when authenticated", async () => {
		const client = createMockClient({
			isAuthenticated: true,
			authType: "token",
			host: "https://github.com",
			login: "testuser",
			statusMessage: "Authenticated via token",
		} as GetAuthStatusResponse);

		const result = await validateAuth(client);

		expect(result.isAuthenticated).toBe(true);
		expect(result.authType).toBe("token");
		expect(result.host).toBe("https://github.com");
		expect(result.login).toBe("testuser");
		expect(result.statusMessage).toBe("Authenticated via token");
	});

	it("should return status with optional fields undefined", async () => {
		const client = createMockClient({
			isAuthenticated: true,
		} as GetAuthStatusResponse);

		const result = await validateAuth(client);

		expect(result.isAuthenticated).toBe(true);
		expect(result.authType).toBeUndefined();
		expect(result.host).toBeUndefined();
		expect(result.login).toBeUndefined();
		expect(result.statusMessage).toBeUndefined();
	});

	it("should throw LoadAPIKeyError when not authenticated", async () => {
		const client = createMockClient({
			isAuthenticated: false,
			statusMessage: "Token expired",
		} as GetAuthStatusResponse);

		await expect(validateAuth(client)).rejects.toThrow(LoadAPIKeyError);
	});

	it("should include status message in error when not authenticated", async () => {
		const client = createMockClient({
			isAuthenticated: false,
			statusMessage: "Token expired",
		} as GetAuthStatusResponse);

		await expect(validateAuth(client)).rejects.toThrow("Token expired");
	});

	it("should throw LoadAPIKeyError when not authenticated without status message", async () => {
		const client = createMockClient({
			isAuthenticated: false,
		} as GetAuthStatusResponse);

		await expect(validateAuth(client)).rejects.toThrow(LoadAPIKeyError);
	});

	it("should include auth suggestions in error message", async () => {
		const client = createMockClient({
			isAuthenticated: false,
		} as GetAuthStatusResponse);

		try {
			await validateAuth(client);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(LoadAPIKeyError);
			const msg = (error as LoadAPIKeyError).message;
			expect(msg).toContain("COPILOT_GITHUB_TOKEN");
			expect(msg).toContain("GH_TOKEN");
			expect(msg).toContain("githubToken");
		}
	});

	it("should throw LoadAPIKeyError when getAuthStatus throws", async () => {
		const client = createMockClient(new Error("Connection refused"));

		await expect(validateAuth(client)).rejects.toThrow(LoadAPIKeyError);
	});

	it("should include original error message when getAuthStatus throws", async () => {
		const client = createMockClient(new Error("Connection refused"));

		try {
			await validateAuth(client);
			expect.unreachable("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(LoadAPIKeyError);
			const msg = (error as LoadAPIKeyError).message;
			expect(msg).toContain("Connection refused");
			expect(msg).toContain("Copilot CLI");
		}
	});
});
