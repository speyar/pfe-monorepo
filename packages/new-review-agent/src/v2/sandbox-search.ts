import type { SandboxManager } from "@packages/sandbox";
import { debug } from "./debug";
import { runCommand } from "./utils";

const CANDIDATE_PATHS = [
  "/usr/local/bin/rg",
  "/usr/bin/rg",
  "/bin/rg",
  "/home/user/.local/bin/rg",
];

export async function ensureRipgrepAvailable(input: {
  sandboxManager: SandboxManager;
  sandboxId: string;
}): Promise<{ available: boolean; method: string }> {
  const direct = await runCommand(input.sandboxManager, input.sandboxId, "rg", [
    "--version",
  ]);
  if (direct.exitCode === 0) {
    return { available: true, method: "preinstalled" };
  }

  const osRelease = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "cat",
    ["/etc/os-release"],
  );
  const osText = `${osRelease.stdout}\n${osRelease.stderr}`.toLowerCase();

  if (osText.includes("alpine")) {
    await runCommand(input.sandboxManager, input.sandboxId, "apk", [
      "add",
      "--no-cache",
      "ripgrep",
    ]);
  } else if (osText.includes("amzn") || osText.includes("amazon linux")) {
    const dnfCheck = await runCommand(
      input.sandboxManager,
      input.sandboxId,
      "dnf",
      ["--version"],
    );
    if (dnfCheck.exitCode === 0) {
      await runCommand(input.sandboxManager, input.sandboxId, "dnf", [
        "install",
        "-y",
        "ripgrep",
      ]);
    }
  } else {
    await runCommand(input.sandboxManager, input.sandboxId, "apt-get", [
      "update",
    ]);
    await runCommand(input.sandboxManager, input.sandboxId, "apt-get", [
      "install",
      "-y",
      "ripgrep",
    ]);
  }

  const postInstall = await runCommand(
    input.sandboxManager,
    input.sandboxId,
    "rg",
    ["--version"],
  );
  if (postInstall.exitCode === 0) {
    return { available: true, method: "package-manager-install" };
  }

  for (const candidate of CANDIDATE_PATHS) {
    const probe = await runCommand(
      input.sandboxManager,
      input.sandboxId,
      candidate,
      ["--version"],
    );
    if (probe.exitCode === 0) {
      debug("ripgrep-found-alt-path", { candidate });
      return { available: true, method: `alt-path:${candidate}` };
    }
  }

  debug("ripgrep-unavailable", {
    firstProbeStderr: direct.stderr,
  });
  return { available: false, method: "unavailable" };
}
