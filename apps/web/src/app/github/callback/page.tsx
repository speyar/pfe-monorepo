import { auth } from "@clerk/nextjs/server";
import { getRepositories } from "@pfe-monorepo/github-api";
import prisma from "@/lib/db";
import RepositoriesList from "@/components/github/repositories-list";

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

  if (!hasValidInstallationId) {
    return <RepositoriesList repositories={[]} />;
  }

  const repos = await getRepositories(installationId);

  if (setupAction === "install") {
    const { userId: clerkUserId } = await auth();

    if (clerkUserId) {
      const user = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });

      if (user) {
        const accountLogin = repos.repositories[0]?.owner?.login ?? "unknown";

        await prisma.$transaction(async (tx) => {
          await tx.githubInstallation.upsert({
            where: { installationId },
            create: {
              installationId,
              accountLogin,
              clerkUserId: user.id,
            },
            update: {
              accountLogin,
              clerkUserId: user.id,
            },
          });

          for (const repo of repos.repositories) {
            await tx.repository.upsert({
              where: { repoId: repo.id },
              create: {
                repoId: repo.id,
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                installationId,
              },
              update: {
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                installationId,
              },
            });
          }
        });
      } else {
        console.warn("[github-callback] user not found in local db", {
          clerkUserId,
          installationId,
        });
      }
    }
  }

  return <RepositoriesList repositories={repos.repositories} />;
}
