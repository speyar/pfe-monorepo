import prisma from '@/lib/db'
import { toAppError, AppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'
import { Prisma } from '@/generated/prisma/client'
import type { NextRequest } from 'next/server'
import type { ReviewStatus } from '@/generated/prisma/client'

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json(
        { error: 'User not authenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    const { id } = await params
    const repoId = (() => {
      const n = Number(id)
      if (!Number.isInteger(n) || n <= 0) {
        throw new AppError({ message: 'Invalid repo id', code: 'BAD_REQUEST', statusCode: 400 })
      }
      return n
    })()

    const user = await prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } })
    if (!user) {
      return Response.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const { search, status, sort, page, limit } = parseSearchParams(request.url)
    const skip = (page - 1) * limit

    const where: Prisma.ReviewWhereInput = {
      repoId,
      repository: { installation: { clerkUserId: user.id } },
    }

    if (search.trim()) {
      const q = search.trim()
      where.prTitle = { contains: q, mode: 'insensitive' }
    }

    if (status && ['completed', 'failed', 'pending'].includes(status)) {
      where.status = status as ReviewStatus
    }

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy: { createdAt: sort === 'oldest' ? 'asc' : 'desc' },
        skip,
        take: limit,
        include: { repository: { select: { fullName: true, name: true } } },
      }),
      prisma.review.count({ where }),
    ])

    const data = reviews.map((r) => ({
      id: r.id,
      repoName: r.repository?.fullName ?? 'unknown',
      repo: r.repository?.name ?? 'unknown',
      prNumber: r.prNumber,
      prTitle: r.prTitle,
      prUrl: r.prUrl,
      prAuthor: r.prAuthor,
      prState: r.prState,
      prMerged: r.prMerged,
      prDraft: r.prDraft,
      headRef: r.headRef,
      baseRef: r.baseRef,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }))

    return Response.json({ data, total, totalPages: Math.ceil(total / limit), page, limit })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch pulls',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
