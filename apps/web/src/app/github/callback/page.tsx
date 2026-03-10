import { getGitHubClient, getRepositories } from "@pfe-monorepo/github-api";

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

  const repos = await getRepositories(Number(installationId));

  return (
    <div>
      Connected successfully. Repositories:{" "}
      {repos.repositories.map((repo) => repo.full_name).join(", ")}. Setup
      action: {setupAction}
    </div>
  );
}
