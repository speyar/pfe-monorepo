export class ReviewAgentError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "ReviewAgentError";
    this.code = code;
    this.cause = cause;
  }
}

export class InputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "INPUT_VALIDATION_ERROR", cause);
    this.name = "InputValidationError";
  }
}

export class OutputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "OUTPUT_VALIDATION_ERROR", cause);
    this.name = "OutputValidationError";
  }
}

export class ProviderConfigError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "PROVIDER_CONFIG_ERROR", cause);
    this.name = "ProviderConfigError";
  }
}
export class ReviewAgentError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "ReviewAgentError";
    this.code = code;
    this.cause = cause;
  }
}

export class InputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "INPUT_VALIDATION_ERROR", cause);
    this.name = "InputValidationError";
  }
}

export class OutputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "OUTPUT_VALIDATION_ERROR", cause);
    this.name = "OutputValidationError";
  }
}

export class ProviderConfigError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "PROVIDER_CONFIG_ERROR", cause);
    this.name = "ProviderConfigError";
  }
}
export class ReviewAgentError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "ReviewAgentError";
    this.code = code;
    this.cause = cause;
  }
}

export class InputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "INPUT_VALIDATION_ERROR", cause);
    this.name = "InputValidationError";
  }
}

export class OutputValidationError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "OUTPUT_VALIDATION_ERROR", cause);
    this.name = "OutputValidationError";
  }
}

export class ProviderConfigError extends ReviewAgentError {
  constructor(message: string, cause?: unknown) {
    super(message, "PROVIDER_CONFIG_ERROR", cause);
    this.name = "ProviderConfigError";
  }
}
