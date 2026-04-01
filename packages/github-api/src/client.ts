import { App } from "octokit";

import { normalizeGitHubError } from "./errors";
import type { CreateGitHubAppClientInput } from "./types";
import type {
  CreateInstallationAccessTokenInput,
  InstallationAccessToken,
} from "./types";

export const createGitHubAppClient = async (
  input: CreateGitHubAppClientInput,
) => {
  try {
    const app = new App({
      appId: input.appId,
      privateKey: input.privateKey,
    });

    const octokit = await app.getInstallationOctokit(input.installationId);
    const client = octokit;

    return client;
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to create GitHub App client");
  }
};

export const createInstallationAccessToken = async (
  input: CreateInstallationAccessTokenInput,
): Promise<InstallationAccessToken> => {
  try {
    const app = new App({
      appId: input.appId,
      privateKey: input.privateKey,
    });

    const response = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: input.installationId,
      },
    );

    return {
      token: response.data.token,
      expiresAt: response.data.expires_at,
    };
  } catch (error) {
    throw normalizeGitHubError(
      error,
      "Failed to create installation access token",
    );
  }
};
