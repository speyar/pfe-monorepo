import type { SandboxManager } from "@packages/sandbox";
import type { BranchContext } from "./types";
import { normalizeBranchName, runCommand, splitLines } from "./utils";

function pickDefaultBranch(branchesText: string, preferred?: string): string {
  const preferredNormalized = preferred
    ? normalizeBranchName(preferred)
    : undefined;
  if (
    preferredNormalized &&
    branchesText.includes(`origin/${preferredNormalized}`)
  ) {
    return preferredNormalized;
  }

  const originHead = /origin\/HEAD\s+->\s+origin\/(\S+)/.exec(
    branchesText,
  )?.[1];
  if (originHead) {
    return normalizeBranchName(originHead);
  }

  if (branchesText.includes("origin/main")) {
    return "main";
  }
  if (branchesText.includes("origin/master")) {
    return "master";
  }
  return "main";
}

export async function prepareBranchContext(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
  branchName: string;
  defaultBranch?: string;
}): Promise<BranchContext> {
  const cwdResult = await input.sandboxManager.runCommand({
    sandboxId: input.sandboxId,
    command: "pwd",
  });
  const workingDir = (cwdResult.stdout ?? "").trim() || "/home/user";

  await runCommand(input.sandboxManager, input.sandboxId, "git", [
    "fetch",
    "--all",
    "--prune",
  ]);
  const branchesResult = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "git",
    ["branch", "-a"],
  );

  const defaultBranch = pickDefaultBranch(
    branchesResult.stdout,
    input.defaultBranch,
  );
  const target = normalizeBranchName(input.branchName);

  const localBranchResult = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "git",
    ["branch", "--list", target],
  );
  const hasLocal = splitLines(localBranchResult.stdout).length > 0;

  const remoteRefResult = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "git",
    ["show-ref", "--verify", `refs/remotes/origin/${target}`],
  );
  const hasRemoteRef = remoteRefResult.exitCode === 0;

  if (!hasLocal && !hasRemoteRef) {
    throw new Error(
      `Target branch '${target}' not found locally or on origin.`,
    );
  }

  if (hasLocal) {
    await runCommand(input.sandboxManager, input.sandboxId, "git", [
      "switch",
      target,
    ]);
    if (hasRemoteRef) {
      await runCommand(input.sandboxManager, input.sandboxId, "git", [
        "switch",
        "-C",
        target,
        `origin/${target}`,
      ]);
    }
  } else {
    await runCommand(input.sandboxManager, input.sandboxId, "git", [
      "switch",
      "-c",
      target,
      "--track",
      `origin/${target}`,
    ]);
  }

  const activeResult = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
  );
  const activeBranch = activeResult.stdout.trim() || target;

  const changedFilesResult = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "git",
    ["diff", "--name-only", `${defaultBranch}...HEAD`],
  );
  const changedFiles = splitLines(changedFilesResult.stdout).map((filePath) =>
    filePath.replace(/\\/g, "/"),
  );

  return {
    workingDir,
    defaultBranch,
    activeBranch,
    changedFiles,
  };
}
