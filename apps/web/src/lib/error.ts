export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "DATABASE_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_ERROR";

type ErrorPayload = {
  error?: string;
  message?: string;
};

const ERROR_STATUS_MAP: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  DATABASE_ERROR: 500,
  EXTERNAL_SERVICE_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(args: {
    message: string;
    code?: AppErrorCode;
    statusCode?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "AppError";
    this.code = args.code ?? "INTERNAL_ERROR";
    this.statusCode = args.statusCode ?? ERROR_STATUS_MAP[this.code];
    this.details = args.details;
    this.cause = args.cause;
  }
}

const getStatusCodeFromUnknown = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }

  const statusCode = (error as { status?: unknown }).status;
  return typeof statusCode === "number" ? statusCode : undefined;
};

const getAppErrorCodeFromStatus = (statusCode: number): AppErrorCode => {
  if (statusCode === 401) {
    return "UNAUTHENTICATED";
  }

  if (statusCode === 404) {
    return "NOT_FOUND";
  }

  if (statusCode === 400 || statusCode === 422) {
    return "BAD_REQUEST";
  }

  if (statusCode >= 500) {
    return "EXTERNAL_SERVICE_ERROR";
  }

  return "INTERNAL_ERROR";
};

const getHttpErrorMessage = (
  payload: unknown,
  statusText: string,
  fallbackMessage: string,
): string => {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (typeof payload === "object" && payload !== null) {
    const errorPayload = payload as ErrorPayload;

    if (
      typeof errorPayload.error === "string" &&
      errorPayload.error.length > 0
    ) {
      return errorPayload.error;
    }

    if (
      typeof errorPayload.message === "string" &&
      errorPayload.message.length > 0
    ) {
      return errorPayload.message;
    }
  }

  if (statusText.trim().length > 0) {
    return statusText;
  }

  return fallbackMessage;
};

export const toAppError = (
  error: unknown,
  fallback: {
    message: string;
    code?: AppErrorCode;
    statusCode?: number;
    details?: unknown;
  },
): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  const code = fallback.code ?? "INTERNAL_ERROR";

  return new AppError({
    message: fallback.message,
    code,
    statusCode:
      fallback.statusCode ??
      getStatusCodeFromUnknown(error) ??
      ERROR_STATUS_MAP[code],
    details: fallback.details,
    cause: error,
  });
};

export const toHttpAppError = (args: {
  statusCode: number;
  statusText: string;
  payload: unknown;
  details?: unknown;
  fallbackMessage?: string;
  cause?: unknown;
}): AppError => {
  const message = getHttpErrorMessage(
    args.payload,
    args.statusText,
    args.fallbackMessage ?? "An error occurred while fetching data",
  );

  return toAppError(args.cause ?? new Error(message), {
    message,
    code: getAppErrorCodeFromStatus(args.statusCode),
    statusCode: args.statusCode,
    details: args.details,
  });
};
