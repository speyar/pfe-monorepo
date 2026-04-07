import { requireCurrentUser } from "@/lib/current-user";
import prisma from "@/lib/db";
import { toAppError } from "@/lib/error";
import { getAccessTokenForUser, listSentryProjects } from "@/lib/sentry-api";
import { getOwnedRepository, parseRepoId } from "../helpers";

type LinkPayload = {
  orgSlug?: string;
  projectSlug?: string;
  environment?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const repoId = parseRepoId(id);
    const repository = await getOwnedRepository({ repoId, userId: user.id });

    const payload = (await request.json()) as LinkPayload;
    const orgSlug = payload.orgSlug?.trim();
    const projectSlug = payload.projectSlug?.trim();
    const environment = payload.environment?.trim() || null;

    if (!orgSlug || !projectSlug) {
      return Response.json(
        { error: "orgSlug and projectSlug are required", code: "BAD_REQUEST" },
        { status: 400 },
      );
    }

    const accessToken = await getAccessTokenForUser(user.id);
    const projects = await listSentryProjects({ accessToken, orgSlug });
    const projectExists = projects.some(
      (project) => project.slug === projectSlug,
    );

    if (!projectExists) {
      return Response.json(
        {
          error: "Selected Sentry project is not accessible",
          code: "BAD_REQUEST",
        },
        { status: 400 },
      );
    }

    const mapping = await prisma.repositorySentryProject.upsert({
      where: {
        repositoryId: repository.id,
      },
      create: {
        repositoryId: repository.id,
        sentryOrgSlug: orgSlug,
        sentryProjectSlug: projectSlug,
        environment,
        enabled: true,
      },
      update: {
        sentryOrgSlug: orgSlug,
        sentryProjectSlug: projectSlug,
        environment,
        enabled: true,
      },
      select: {
        sentryOrgSlug: true,
        sentryProjectSlug: true,
        environment: true,
        enabled: true,
      },
    });

    return Response.json({ data: mapping }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to link repository to Sentry",
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

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const repoId = parseRepoId(id);
    const repository = await getOwnedRepository({ repoId, userId: user.id });

    await prisma.repositorySentryProject.deleteMany({
      where: {
        repositoryId: repository.id,
      },
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to unlink repository from Sentry",
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
