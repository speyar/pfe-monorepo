import { createGitHubAppClient } from "@pfe-monorepo/github-api";

export default async function GithubCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ installation_id: string; setup_action: string }>;
}) {
  const installationId = (await searchParams).installation_id;
  const setupAction = (await searchParams).setup_action;

  if (!installationId) {
    return <div>No installation id</div>;
  }

  const github = await createGitHubAppClient({
    appId: Number(process.env.GITHUB_APP_ID),
    privateKey: process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    installationId: Number(installationId),
  });

  const repos = await github.rest.apps.listReposAccessibleToInstallation();

  return (
    <div>
      Connected successfully. Repositories: {repos.data.repositories.length}
    </div>
  );
}
