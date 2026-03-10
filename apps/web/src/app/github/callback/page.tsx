import { getRepositories, Repository } from "@pfe-monorepo/github-api";
import RepositoriesList from "@/components/github/repositories-list";

export default async function GithubCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ installation_id?: string; setup_action?: string }>;
}) {
  const params = await searchParams;
  const installationId = params.installation_id;

  const repos = await getRepositories(Number(installationId));

  return <RepositoriesList repositories={repos.repositories} />;
}
