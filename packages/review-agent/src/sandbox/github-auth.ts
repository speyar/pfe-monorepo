import { App } from "octokit";

import type { NormalizedReviewRequest } from "../core/normalize-input";

export class SandboxAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SandboxAuthError";
  }
}

function parseInstallationId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function resolveInstallationId(input: NormalizedReviewRequest): number {
  const metadata = input.metadata as Record<string, unknown> | undefined;

  const direct = parseInstallationId(metadata?.installationId);
  if (direct) {
    return direct;
  }

  throw new SandboxAuthError(
    "Missing installationId in review request metadata. Sandbox mode requires GitHub App installation context for private repository access.",
  );
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SandboxAuthError(`Missing required env variable: ${name}.`);
  }

  return value;
}

export async function createRepositoryCloneAuth(
  input: NormalizedReviewRequest,
): Promise<{ username: string; password: string }> {
  const installationId = resolveInstallationId(input);
  const appIdRaw = getRequiredEnv("GITHUB_APP_ID");
  const privateKey = getRequiredEnv("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n");
  const appId = Number(appIdRaw);

  if (!Number.isInteger(appId) || appId <= 0) {
    throw new SandboxAuthError(
      "Invalid GITHUB_APP_ID. Expected a positive integer.",
    );
  }

  try {
    const app = new App({ appId, privateKey });

    const response = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
      },
    );

    return {
      username: "x-access-token",
      password: response.data.token,
    };
  } catch (error) {
    throw new SandboxAuthError(
      "Failed to create installation token for sandbox repository clone.",
      { cause: error },
    );
  }
}
