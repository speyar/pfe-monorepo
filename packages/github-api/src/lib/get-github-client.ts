import { createGitHubAppClient } from "../client";

export const getGitHubClient = async (installationId: number) => {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId) {
    throw new Error("GITHUB_APP_ID env var is required");
  }
  if (!privateKey) {
    throw new Error("GITHUB_PRIVATE_KEY env var is required");
  }

  return await createGitHubAppClient({
    appId: Number(appId),
    privateKey: privateKey.replace(/\\n/g, "\n"),
    installationId,
  });
};
