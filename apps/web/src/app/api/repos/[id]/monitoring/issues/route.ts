import { requireCurrentUser } from "@/lib/current-user";
import prisma from "@/lib/db";
import { toAppError } from "@/lib/error";
import { getAccessTokenForUser, listSentryIssues } from "@/lib/sentry-api";
import { getOwnedRepository, parseRepoId } from "../helpers";

export async function GET(
  request: Request,
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
      },
    });

    if (!mapping || !mapping.enabled) {
      return Response.json(
        {
          error: "Repository is not linked to a Sentry project",
          code: "NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status")?.trim() || undefined;
    const query = url.searchParams.get("query")?.trim() || undefined;
    const statsPeriod =
      url.searchParams.get("statsPeriod")?.trim() || undefined;
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;

    const accessToken = await getAccessTokenForUser(user.id);
    const issues = await listSentryIssues({
      accessToken,
      orgSlug: mapping.sentryOrgSlug,
      projectSlug: mapping.sentryProjectSlug,
      environment: mapping.environment ?? undefined,
      status,
      query,
      statsPeriod,
      cursor,
    });

    const issuesWithoutEnvironment =
      mapping.environment && issues.data.length === 0
        ? await listSentryIssues({
            accessToken,
            orgSlug: mapping.sentryOrgSlug,
            projectSlug: mapping.sentryProjectSlug,
            status,
            query,
            statsPeriod,
            cursor,
          })
        : null;

    const data = issuesWithoutEnvironment?.data ?? issues.data;
    const nextCursor =
      issuesWithoutEnvironment?.nextCursor ?? issues.nextCursor;

    return Response.json(
      {
        data,
        nextCursor,
      },
      { status: 200 },
    );
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to fetch Sentry issues",
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
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
