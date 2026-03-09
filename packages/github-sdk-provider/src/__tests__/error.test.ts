import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import type { CopilotErrorMetadata } from "../error";
import {
	createAPICallError,
	createAuthenticationError,
	createTimeoutError,
	getErrorMetadata,
	isAuthenticationError,
	isRetryableError,
	isTimeoutError,
	mapCopilotError,
	wrapError,
} from "../error";

describe("mapCopilotError", () => {
	describe("authentication errors (LoadAPIKeyError)", () => {
		it("should detect 'unauthorized' as auth error", () => {
			const result = mapCopilotError(new Error("Unauthorized request"));
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});

		it("should detect 'authentication' as auth error", () => {
			const result = mapCopilotError(new Error("Authentication failed"));
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});

		it("should detect 'not authenticated' as auth error", () => {
			const result = mapCopilotError(new Error("User is not authenticated"));
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});

		it("should detect 'token' as auth error", () => {
			const result = mapCopilotError(new Error("Invalid token provided"));
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});
	});

	describe("rate limit errors (429)", () => {
		it("should detect 'rate limit' errors", () => {
			const result = mapCopilotError(new Error("Rate limit exceeded"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(429);
			expect((result as APICallError).isRetryable).toBe(true);
			expect(((result as APICallError).data as CopilotErrorMetadata)?.code).toBe("RATE_LIMIT");
		});

		it("should detect 'quota' errors", () => {
			const result = mapCopilotError(new Error("Quota exceeded"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(429);
		});
	});

	describe("timeout errors (504)", () => {
		it("should detect 'timeout' errors", () => {
			const result = mapCopilotError(new Error("Request timeout"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(504);
			expect((result as APICallError).isRetryable).toBe(true);
			expect(((result as APICallError).data as CopilotErrorMetadata)?.code).toBe("TIMEOUT");
		});

		it("should detect 'timed out' errors", () => {
			const result = mapCopilotError(new Error("Connection timed out"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(504);
		});
	});

	describe("model not found errors (404)", () => {
		it("should detect 'not found' errors", () => {
			const result = mapCopilotError(new Error("Resource not found"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(404);
			expect((result as APICallError).isRetryable).toBe(false);
		});

		it("should detect 'no such model' errors", () => {
			const result = mapCopilotError(new Error("No such model: gpt-99"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(404);
		});
	});

	describe("invalid request errors (400)", () => {
		it("should detect 'bad request' errors", () => {
			const result = mapCopilotError(new Error("Bad request: missing field"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(400);
			expect((result as APICallError).isRetryable).toBe(false);
		});

		it("should detect 'invalid' errors", () => {
			const result = mapCopilotError(new Error("Invalid parameter value"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(400);
		});
	});

	describe("CLI process errors (502)", () => {
		it("should detect 'cli server exited' errors", () => {
			const result = mapCopilotError(new Error("CLI server exited unexpectedly"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(502);
			expect((result as APICallError).isRetryable).toBe(true);
		});

		it("should detect 'econnrefused' errors", () => {
			const result = mapCopilotError(new Error("connect ECONNREFUSED"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(502);
			expect((result as APICallError).isRetryable).toBe(true);
		});
	});

	describe("abort errors", () => {
		it("should re-throw AbortError without wrapping", () => {
			const abortError = new Error("Aborted");
			abortError.name = "AbortError";

			expect(() => mapCopilotError(abortError)).toThrow(abortError);
		});
	});

	describe("fallback errors (500)", () => {
		it("should map generic errors to 500", () => {
			const result = mapCopilotError(new Error("Something unexpected"));
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(500);
			expect((result as APICallError).isRetryable).toBe(true);
		});
	});

	describe("non-Error inputs", () => {
		it("should handle string errors", () => {
			const result = mapCopilotError("string error");
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(500);
			expect(result.message).toContain("string error");
		});

		it("should handle null errors", () => {
			const result = mapCopilotError(null);
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(500);
		});

		it("should handle undefined errors", () => {
			const result = mapCopilotError(undefined);
			expect(result).toBeInstanceOf(APICallError);
			expect((result as APICallError).statusCode).toBe(500);
		});

		it("should handle number errors", () => {
			const result = mapCopilotError(42);
			expect(result).toBeInstanceOf(APICallError);
			expect(result.message).toContain("42");
		});
	});

	describe("error priority", () => {
		it("should prioritize auth over invalid request", () => {
			const result = mapCopilotError(new Error("Invalid API key token"));
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});

		it("should prioritize auth over rate limit when both match", () => {
			const result = mapCopilotError(new Error("Unauthorized rate limit exceeded token"));
			// auth check happens before rate limit check
			expect(result).toBeInstanceOf(LoadAPIKeyError);
		});
	});
});

describe("error factory functions", () => {
	describe("createAPICallError", () => {
		it("should create an APICallError with defaults", () => {
			const error = createAPICallError({ message: "Test error" });

			expect(error).toBeInstanceOf(APICallError);
			expect(error.message).toBe("Test error");
			expect(error.statusCode).toBe(500);
			expect(error.isRetryable).toBe(false);
			expect(error.url).toBe("copilot-sdk://cli-server");
		});

		it("should accept custom statusCode and retryable flag", () => {
			const error = createAPICallError({
				message: "Retryable",
				code: "TIMEOUT",
				isRetryable: true,
				statusCode: 504,
			});

			expect(error.statusCode).toBe(504);
			expect(error.isRetryable).toBe(true);
			expect((error.data as CopilotErrorMetadata)?.code).toBe("TIMEOUT");
		});
	});

	describe("createAuthenticationError", () => {
		it("should create a LoadAPIKeyError", () => {
			const error = createAuthenticationError({ message: "No token" });

			expect(error).toBeInstanceOf(LoadAPIKeyError);
			expect(error.message).toContain("No token");
		});
	});

	describe("createTimeoutError", () => {
		it("should create a retryable 504 error", () => {
			const error = createTimeoutError({ message: "Timed out" });

			expect(error).toBeInstanceOf(APICallError);
			expect(error.statusCode).toBe(504);
			expect(error.isRetryable).toBe(true);
			expect((error.data as CopilotErrorMetadata)?.code).toBe("TIMEOUT");
		});
	});
});

describe("error detection utilities", () => {
	describe("isAuthenticationError", () => {
		it("should return true for LoadAPIKeyError instances", () => {
			const error = new LoadAPIKeyError({ message: "test" });
			expect(isAuthenticationError(error)).toBe(true);
		});

		it("should return true for errors with auth-related messages", () => {
			expect(isAuthenticationError(new Error("Unauthorized"))).toBe(true);
			expect(isAuthenticationError(new Error("authentication failed"))).toBe(true);
			expect(isAuthenticationError(new Error("invalid credentials"))).toBe(true);
		});

		it("should return false for non-auth errors", () => {
			expect(isAuthenticationError(new Error("Something else"))).toBe(false);
		});

		it("should return false for non-Error values", () => {
			expect(isAuthenticationError("string")).toBe(false);
			expect(isAuthenticationError(null)).toBe(false);
		});
	});

	describe("isTimeoutError", () => {
		it("should return true for APICallError with 504", () => {
			const error = createTimeoutError({ message: "timeout" });
			expect(isTimeoutError(error)).toBe(true);
		});

		it("should return true for errors with timeout message", () => {
			expect(isTimeoutError(new Error("Request timeout"))).toBe(true);
			expect(isTimeoutError(new Error("Connection timed out"))).toBe(true);
		});

		it("should return false for non-timeout errors", () => {
			expect(isTimeoutError(new Error("Invalid parameter value"))).toBe(false);
		});

		it("should return false for non-Error values", () => {
			expect(isTimeoutError(42)).toBe(false);
		});
	});

	describe("isRetryableError", () => {
		it("should return true for retryable APICallErrors", () => {
			const error = createAPICallError({
				message: "test",
				isRetryable: true,
			});
			expect(isRetryableError(error)).toBe(true);
		});

		it("should return false for non-retryable APICallErrors", () => {
			const error = createAPICallError({
				message: "test",
				isRetryable: false,
			});
			expect(isRetryableError(error)).toBe(false);
		});

		it("should detect retryable patterns in plain errors", () => {
			expect(isRetryableError(new Error("timeout occurred"))).toBe(true);
			expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
			expect(isRetryableError(new Error("ECONNREFUSED"))).toBe(true);
			expect(isRetryableError(new Error("socket hang up"))).toBe(true);
			expect(isRetryableError(new Error("cli server exited"))).toBe(true);
			expect(isRetryableError(new Error("rate limit reached"))).toBe(true);
		});

		it("should return false for non-retryable plain errors", () => {
			expect(isRetryableError(new Error("Invalid input"))).toBe(false);
		});
	});

	describe("getErrorMetadata", () => {
		it("should extract metadata from APICallError", () => {
			const error = createAPICallError({
				message: "test",
				code: "RATE_LIMIT",
			});

			const metadata = getErrorMetadata(error);

			expect(metadata).toBeDefined();
			expect(metadata?.code).toBe("RATE_LIMIT");
		});

		it("should return undefined for non-APICallError", () => {
			expect(getErrorMetadata(new Error("plain"))).toBeUndefined();
			expect(getErrorMetadata("string")).toBeUndefined();
		});
	});
});

describe("wrapError (deprecated)", () => {
	it("should wrap an Error with context", () => {
		const original = new Error("Original message");
		const wrapped = wrapError(original, "Context");

		expect(wrapped.message).toBe("Context: Original message");
		expect(wrapped.stack).toBe(original.stack);
	});

	it("should wrap a non-Error value with context", () => {
		const wrapped = wrapError("some string", "Context");

		expect(wrapped.message).toBe("Context: some string");
	});
});
