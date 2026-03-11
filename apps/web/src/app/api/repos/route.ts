import prisma from "@/lib/db";
import { toAppError } from "@/lib/error";
import { auth } from "@clerk/nextjs/server";
import type { Repository } from "@pfe-monorepo/github-api";
import type { NextRequest } from "next/server";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

const parsePositiveInt = (value: string | null, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

export async function GET(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return Response.json(
        {
          error: "User not authenticated",
          code: "UNAUTHENTICATED",
        },
        { status: 401 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });

    if (!user) {
      return Response.json(
        {
          error: "User not found in DB",
          code: "NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const requestedPage = parsePositiveInt(
      request.nextUrl.searchParams.get("page"),
      DEFAULT_PAGE,
    );

    const limit = parsePositiveInt(
      request.nextUrl.searchParams.get("limit"),
      DEFAULT_LIMIT,
    );

    const whereClause = {
      installation: {
        clerkUserId: user.id,
      },
    };

    const totalRepositories = await prisma.repository.count({
      where: whereClause,
    });

    const totalPages = Math.max(1, Math.ceil(totalRepositories / limit));
    const page = Math.min(requestedPage, totalPages);
    const skip = (page - 1) * limit;

    const repositoriesFromDb = await prisma.repository.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        installation: {
          select: {
            accountLogin: true,
          },
        },
      },
    });

    const data: Repository[] = repositoriesFromDb.map((repository) => ({
      id: repository.repoId,
      owner: { login: repository.installation.accountLogin },
      name: repository.name,
      full_name: repository.fullName,
      html_url: `https://github.com/${repository.fullName}`,
      private: repository.private,
      description: null,
    }));

    return Response.json(
      {
        data,
        page,
        totalPages,
      },
      { status: 200 },
    );
  } catch (error) {
    const appError = toAppError(error, {
      message: "Failed to fetch repositories",
      code: "DATABASE_ERROR",
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
