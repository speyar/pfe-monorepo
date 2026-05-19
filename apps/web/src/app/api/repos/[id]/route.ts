import { AppError } from '@/lib/error'
import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'

function parseRepoId(rawId: string): number {
  const repoId = Number(rawId)
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new AppError({
      message: 'Invalid repository id',
      code: 'BAD_REQUEST',
      statusCode: 400,
    })
  }
  return repoId
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json(
        { error: 'User not authenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    const user = await prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } })
    if (!user) {
      return Response.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const { id } = await params
    const repoId = parseRepoId(id)

    const repo = await prisma.repository.findFirst({
      where: { repoId, installation: { clerkUserId: user.id } },
      include: {
        sentryProject: true,
        _count: { select: { reviews: true } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    })

    if (!repo) {
      return Response.json({ error: 'Repository not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const monitoring = repo.sentryProject
      ? {
          enabled: repo.sentryProject.enabled,
          orgSlug: repo.sentryProject.sentryOrgSlug,
          projectSlug: repo.sentryProject.sentryProjectSlug,
          environment: repo.sentryProject.environment,
        }
      : null

    return Response.json({
      id: repo.repoId,
      repoId: repo.repoId,
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      reviewCount: repo._count.reviews,
      monitoring,
      recentReviews: repo.reviews.map((r) => ({
        id: r.id,
        prNumber: r.prNumber,
        prTitle: r.prTitle,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch repository',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
