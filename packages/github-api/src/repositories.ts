import { normalizeGitHubError } from "./errors";
import { getGitHubClient } from "./lib/get-github-client";

export const getRepositories = async (installationId: number) => {
  try {
    const client = await getGitHubClient(Number(installationId));
    const response = await client.rest.apps.listReposAccessibleToInstallation();
    return response.data;
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to fetch repositories");
  }
};
