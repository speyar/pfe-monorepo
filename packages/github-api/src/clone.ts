import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { normalizeGitHubError } from "./errors";
import type { GitHubOwnerRepo } from "./types";

export type CloneRepositoryInput = GitHubOwnerRepo & {
  destinationPath: string;
  ref?: string;
  depth?: number;
  authToken?: string;
};

export type CloneRepositoryResult = {
  repositoryUrl: string;
  destinationPath: string;
  ref?: string;
};

const buildRepositoryUrl = (input: GitHubOwnerRepo, authToken?: string): string => {
  if (!authToken) {
    return `https://github.com/${input.owner}/${input.repo}.git`;
  }

  return `https://x-access-token:${encodeURIComponent(authToken)}@github.com/${input.owner}/${input.repo}.git`;
};

const runGit = (args: string[], cwd?: string): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(stderr.trim() || `git exited with code ${code}`));
    });
  });

const ensureEmptyDestination = async (destinationPath: string): Promise<void> => {
  await mkdir(destinationPath, { recursive: true });
  const children = await readdir(destinationPath);

  if (children.length > 0) {
    throw new Error(`Destination path is not empty: ${destinationPath}`);
  }
};

export const cloneRepository = async (
  input: CloneRepositoryInput
): Promise<CloneRepositoryResult> => {
  try {
    const destinationPath = resolve(input.destinationPath);
    await ensureEmptyDestination(destinationPath);

    const repositoryUrl = buildRepositoryUrl(input, input.authToken);
    const cloneArgs = ["clone", repositoryUrl, destinationPath];

    if (input.depth && input.depth > 0) {
      cloneArgs.push("--depth", String(input.depth));
    }

    await runGit(cloneArgs);

    if (input.ref) {
      await runGit(["checkout", input.ref], destinationPath);
    }

    return {
      repositoryUrl,
      destinationPath,
      ref: input.ref,
    };
  } catch (error) {
    throw normalizeGitHubError(error, "Failed to clone repository");
  }
};
