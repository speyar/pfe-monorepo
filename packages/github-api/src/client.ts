import { App } from "@octokit/app";

import { normalizeGitHubError } from "./errors";
import type { CreateGitHubAppClientInput, GitHubClient } from "./types";

export const createGitHubAppClient = async (
  input: CreateGitHubAppClientInput
): Promise<GitHubClient> => {
  try {
    const app = new App({
      appId: input.appId,
      privateKey: input.privateKey,
    });

    const octokit = await app.getInstallationOctokit(input.installationId);
    return octokit as GitHubClient;
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to create GitHub App client");
  }
};
