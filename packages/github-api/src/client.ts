import { App } from "octokit";

import { normalizeGitHubError } from "./errors";
import type { CreateGitHubAppClientInput } from "./types";

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
