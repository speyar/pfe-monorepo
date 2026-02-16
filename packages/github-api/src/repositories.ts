import { normalizeGitHubError } from "./errors";
import type { GitHubClient, GitHubOwnerRepo, RepositorySummary } from "./types";

export const getRepository = async (
  client: GitHubClient,
  input: GitHubOwnerRepo
): Promise<RepositorySummary> => {
  try {
    const response = await client.rest.repos.get({
      owner: input.owner,
      repo: input.repo,
    });

    const data = response.data;

    return {
      id: data.id,
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      private: data.private,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to fetch repository");
  }
};
