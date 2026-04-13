import prisma from "@/lib/db";
import { AppError } from "@/lib/error";

export function parseRepoId(rawId: string): number {
  const repoId = Number(rawId);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new AppError({
      message: "Invalid repository id",
      code: "BAD_REQUEST",
      statusCode: 400,
    });
  }

  return repoId;
}

export async function getOwnedRepository(args: {
  repoId: number;
  userId: string;
}) {
  const repository = await prisma.repository.findFirst({
    where: {
      repoId: args.repoId,
      installation: {
        clerkUserId: args.userId,
      },
    },
    select: {
      id: true,
      repoId: true,
      fullName: true,
    },
  });

  if (!repository) {
    throw new AppError({
      message: "Repository not found",
      code: "NOT_FOUND",
      statusCode: 404,
    });
  }

  return repository;
}
