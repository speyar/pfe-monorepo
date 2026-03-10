import { createGitHubAppClient } from "../client";

export const getGitHubClient = async (installationId: number) => {
  return await createGitHubAppClient({
    appId: Number(process.env.GITHUB_APP_ID),
    privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    installationId,
  });
};
