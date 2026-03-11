export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "DATABASE_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_ERROR";

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
