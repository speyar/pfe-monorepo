import { createGitHubCopilotProvider } from "@ceira/github-sdk-provider";
import type { LanguageModel } from "ai";

import { ProviderConfigError } from "../errors/review-errors";

export interface CreateGitHubReviewModelInput {
  githubToken?: string;
  model?: string;
  useLoggedInUser?: boolean;
  cliPath?: string;
}

export function createGitHubReviewModel(
  input: CreateGitHubReviewModelInput = {},
): LanguageModel {
  const githubToken = process.env.COPILOT_GITHUB_TOKEN;

  if (!githubToken && input.useLoggedInUser === false) {
    throw new ProviderConfigError(
      "Set COPILOT_GITHUB_TOKEN, or enable useLoggedInUser.",
    );
  }

  const provider = createGitHubCopilotProvider({
    githubToken,
    useLoggedInUser: input.useLoggedInUser,
    cliPath: input.cliPath,
  });

  return provider(input.model ?? "gpt-5.3-codex");
}
