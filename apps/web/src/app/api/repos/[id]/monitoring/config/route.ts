import { requireCurrentUser } from "@/lib/current-user";
import prisma from "@/lib/db";
import { toAppError } from "@/lib/error";
import { getOwnedRepository, parseRepoId } from "../helpers";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const repoId = parseRepoId(id);
    const repository = await getOwnedRepository({ repoId, userId: user.id });

    const mapping = await prisma.repositorySentryProject.findUnique({
      where: {
        repositoryId: repository.id,
      },
      select: {
        sentryOrgSlug: true,
        sentryProjectSlug: true,
        environment: true,
        enabled: true,
        updatedAt: true,
      },
    });

    return Response.json(
      {
        data: {
          repository: {
            id: repository.id,
            repoId: repository.repoId,
            fullName: repository.fullName,
          },
          sentry: mapping,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to load repository monitoring config",
      code: "INTERNAL_ERROR",
      statusCode: 500,
    });

    return Response.json(
      {
        error: appError.message,
        code: appError.code,
      },
      { status: appError.statusCode },
    );
  }
}
