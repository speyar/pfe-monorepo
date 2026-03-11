"use server";

import prisma from "@/lib/db";
import { AppError, toAppError } from "@/lib/error";
import { auth } from "@clerk/nextjs/server";
import { Repository } from "@pfe-monorepo/github-api";

export async function handleGithubInstallation({
  installationId,
  repositories,
}: {
  installationId: number;
  repositories: Repository[];
}) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    throw new AppError({
      message: "User not authenticated",
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });

  if (!user) {
    throw new AppError({
      message: "User not found in DB",
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }

  const accountLogin = repositories[0]?.owner?.login ?? "unknown";

  if (!repositories.length) {
    throw new AppError({
      message: "No repositories found for installation",
      code: "BAD_REQUEST",
      details: { installationId },
    });
  }

  try {
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

      for (const repo of repositories) {
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
  } catch (error) {
    throw toAppError(error, {
      message: "Failed to save GitHub installation",
      code: "DATABASE_ERROR",
      statusCode: 500,
      details: { installationId },
    });
  }
}
