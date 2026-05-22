import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import { Prisma } from '@/generated/prisma/client'
import type { NextRequest } from 'next/server'
import type { FixRunStatus } from '@/generated/prisma/client'

function parseSearchParams(url: string) {
  const { searchParams } = new URL(url)
  return {
    search: searchParams.get('search') || '',
    status: searchParams.get('status') || '',
    sort: searchParams.get('sort') === 'oldest' ? 'oldest' as const : 'newest' as const,
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    limit: Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 10)),
  }
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
      return Response.json({ data: [], total: 0, totalPages: 0, page: 1, limit: 10 })
    }

    const { search, status, sort, page, limit } = parseSearchParams(request.url)
    const skip = (page - 1) * limit

    const where: Prisma.FixRunWhereInput = {
      repository: { installation: { clerkUserId: user.id } },
    }

    if (search.trim()) {
      const q = search.trim()
      where.OR = [
        { issueTitle: { contains: q, mode: 'insensitive' } },
        { repository: { fullName: { contains: q, mode: 'insensitive' } } },
      ]
    }

    if (status && ['running', 'success', 'failed'].includes(status)) {
      where.status = status as FixRunStatus
    }

    const [fixRuns, total] = await Promise.all([
      prisma.fixRun.findMany({
        where,
        orderBy: { createdAt: sort === 'oldest' ? 'asc' : 'desc' },
        skip,
        take: limit,
        include: { repository: { select: { fullName: true, name: true } } },
      }),
      prisma.fixRun.count({ where }),
    ])

    const data = fixRuns.map((r) => ({
      id: r.id,
      repoName: r.repository?.fullName ?? 'unknown',
      issueId: r.issueId,
      issueTitle: r.issueTitle,
      status: r.status,
      prUrl: r.prUrl,
      branchName: r.branchName,
      summary: r.summary,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))

    return Response.json({ data, total, totalPages: Math.ceil(total / limit), page, limit })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch fix runs',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
