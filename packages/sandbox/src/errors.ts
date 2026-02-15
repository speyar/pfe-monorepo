export class SandboxError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    this.cause = cause;
  }
}

export class ConfigError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
    this.name = "ConfigError";
  }
}

export class AuthError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "AUTH_ERROR", cause);
    this.name = "AuthError";
  }
}

export class RateLimitError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "RATE_LIMIT_ERROR", cause);
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "TIMEOUT_ERROR", cause);
    this.name = "TimeoutError";
  }
}

export class NotFoundError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "NOT_FOUND", cause);
    this.name = "NotFoundError";
  }
}

export class PersistenceError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "PERSISTENCE_ERROR", cause);
    this.name = "PersistenceError";
  }
}

export class ReconciliationError extends SandboxError {
  constructor(message: string, cause?: unknown) {
    super(message, "RECONCILIATION_ERROR", cause);
    this.name = "ReconciliationError";
  }
}

export function isRetryableSandboxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  if (name.includes("ratelimit") || name.includes("timeout")) {
    return true;
  }

  const status = (error as { status?: number }).status;
  if (typeof status === "number") {
    return status === 429 || status >= 500;
  }

  return false;
}
