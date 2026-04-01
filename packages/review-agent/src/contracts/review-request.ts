export type FileChangeStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ReviewRepository {
  owner: string;
  name: string;
  defaultBranch?: string;
}

export interface ReviewPullRequest {
  number: number;
  title: string;
  body?: string;
  baseSha: string;
  headSha: string;
  baseRef?: string;
  headRef?: string;
}

export interface ReviewRequestFile {
  path: string;
  status?: FileChangeStatus;
  patch?: string;
  content?: string;
  language?: string;
}

export interface ReviewRequestConfig {
  maxFindings?: number;
  includeSuggestions?: boolean;
  includeInfoFindings?: boolean;
  focusAreas?: string[];
  maxPatchCharsPerFile?: number;
}

export interface ReviewRequest {
  repository: ReviewRepository;
  pullRequest: ReviewPullRequest;
  files: ReviewRequestFile[];
  config?: ReviewRequestConfig;
  metadata?: Record<string, unknown>;
}
