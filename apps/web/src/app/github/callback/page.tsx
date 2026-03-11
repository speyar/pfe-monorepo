import { getRepositories } from "@pfe-monorepo/github-api";
import prisma from "@/lib/db";
import { toAppError } from "@/lib/error";
import ErrorCard from "@/components/error/error-card";
import { redirect } from "next/navigation";
import { handleGithubInstallation } from "@/app/actions/github/handle-github-app-installation";
import GithubInstallSuccess from "@/components/github/github-install-success";

export default async function GithubCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ installation_id?: string; setup_action?: string }>;
}) {
  const params = await searchParams;
  const installationIdValue = params.installation_id;
  const setupAction = params.setup_action;

  const installationId = Number(installationIdValue);
  const hasValidInstallationId =
    Number.isInteger(installationId) && installationId > 0;

  if (!hasValidInstallationId || setupAction !== "install") {
    redirect("/");
  }

  const existingInstallation = await prisma.githubInstallation.findUnique({
    where: { installationId },
  });

  // Prevent accessing page if already installed
  if (existingInstallation) {
    redirect("/");
  }

  let repos: Awaited<ReturnType<typeof getRepositories>>;

  try {
    repos = await getRepositories(installationId);
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to fetch repositories for this installation",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
      details: { installationId },
    });

    return <ErrorCard title="Unable to fetch repositories" error={appError} />;
  }

  try {
    await handleGithubInstallation({
      installationId,
      repositories: repos.repositories,
    });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to link GitHub installation",
      code: "DATABASE_ERROR",
      statusCode: 500,
      details: { installationId },
    });

    return <ErrorCard title="Unable to link installation" error={appError} />;
  }

  return <GithubInstallSuccess />;
}
