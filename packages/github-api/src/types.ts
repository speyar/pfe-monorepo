import type { App } from "octokit";

export type GitHubClient = Awaited<ReturnType<App["getInstallationOctokit"]>>;

export type GitHubOwnerRepo = {
  owner: string;
  repo: string;
};

export type GitHubAppAuthInput = {
  appId: number;
  privateKey: string;
  installationId: number;
};

export type CreateGitHubAppClientInput = GitHubAppAuthInput;

export type RepositorySummary = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
};

export type PullRequestSummary = {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  mergeable: boolean | null;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
};

export type PullRequestFile = {
  filename: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  blobUrl: string | null;
  patch: string | null;
};

export type PullRequestDiff = {
  repository: GitHubOwnerRepo;
  pullRequestNumber: number;
  diff: string;
};
