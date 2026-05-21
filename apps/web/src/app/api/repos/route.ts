import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
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
      return Response.json({ data: [] })
    }

    const whereClause = { installation: { clerkUserId: user.id } }
    const search = request.nextUrl.searchParams.get('search')?.trim()
    const searchFilter = search
      ? { ...whereClause, fullName: { contains: search, mode: 'insensitive' as const } }
      : whereClause

    const repositoriesFromDb = await prisma.repository.findMany({
      where: searchFilter,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        installation: { select: { accountLogin: true } },
        sentryProject: { select: { enabled: true, sentryOrgSlug: true } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        _count: { select: { reviews: true } },
      },
    })

    const data = repositoriesFromDb.map((repo) => ({
      id: repo.repoId,
      owner: { login: repo.installation.accountLogin },
      name: repo.name,
      full_name: repo.fullName,
      html_url: `https://github.com/${repo.fullName}`,
      private: repo.private,
      description: null,
      sentryProject: repo.sentryProject,
      reviewCount: repo._count.reviews,
      lastReviewAt: repo.reviews[0]?.createdAt.toISOString() ?? null,
    }))

    return Response.json({ data })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch repositories',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
