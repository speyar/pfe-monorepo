import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50

const parsePositiveInt = (value: string | null, fallback: number): number => {
  if (!value) return fallback
  const parsedValue = Number(value)
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) return fallback
  return parsedValue
}

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
      return Response.json({ data: [], page: 1, totalPages: 0, total: 0 })
    }

    const whereClause = { installation: { clerkUserId: user.id } }
    const search = request.nextUrl.searchParams.get('search')?.trim()
    const searchFilter = search
      ? { ...whereClause, fullName: { contains: search, mode: 'insensitive' as const } }
      : whereClause

    const requestedPage = parsePositiveInt(request.nextUrl.searchParams.get('page'), DEFAULT_PAGE)
    const limit = parsePositiveInt(request.nextUrl.searchParams.get('limit'), DEFAULT_LIMIT)

    const totalRepositories = await prisma.repository.count({ where: searchFilter })
    const totalPages = Math.max(1, Math.ceil(totalRepositories / limit))
    const page = Math.min(requestedPage, totalPages)
    const skip = (page - 1) * limit

    const repositoriesFromDb = await prisma.repository.findMany({
      where: searchFilter,
      skip,
      take: limit,
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

    return Response.json({ data, page, totalPages, total: totalRepositories })
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
