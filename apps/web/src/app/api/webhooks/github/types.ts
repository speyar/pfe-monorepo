import type { Repository } from "@pfe-monorepo/github-api";

export type GitHubAccount = {
  login?: string;
};

export type GitHubInstallation = {
  id?: number;
  account?: GitHubAccount;
};

export type InstallationRepositoriesPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repositories_added?: Repository[];
  repositories_removed?: Repository[];
  sender?: {
    login?: string;
  };
};

export type InstallationPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repositories?: Repository[];
  sender?: {
    login?: string;
  };
};

export type PullRequestPayload = {
  action?: string;
  installation?: GitHubInstallation;
  repository?: {
    id?: number;
    name?: string;
    full_name?: string;
    default_branch?: string;
    owner?: {
      login?: string;
    };
    private?: boolean;
    html_url?: string;
  };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
    draft?: boolean;
    user?: {
      login?: string;
    };
    head?: {
      sha?: string;
      ref?: string;
    };
    base?: {
      sha?: string;
      ref?: string;
    };
  };
  sender?: {
    login?: string;
  };
};

export type InstallationSyncStatus =
  | "installation_deleted"
  | "installation_synced"
  | "ignored_installation_not_linked";

export type PullRequestReviewDbStatus =
  | "saved"
  | "skipped_repository_not_found";
