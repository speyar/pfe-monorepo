import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'

export async function GET() {
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
      return Response.json({ alerts: [], total: 0 })
    }

    const whereClause = { repository: { installation: { clerkUserId: user.id } } }

    const [failedReviews, pendingReviews, recentFailed] = await Promise.all([
      prisma.review.count({ where: { ...whereClause, status: 'failed' } }),
      prisma.review.count({ where: { ...whereClause, status: 'pending' } }),
      prisma.review.findMany({
        where: { ...whereClause, status: 'failed' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { repository: { select: { fullName: true } } },
      }),
    ])

    const alerts: {
      type: string
      severity: string
      title: string
      description: string
      repoName: string
      createdAt: string
    }[] = [
      ...recentFailed.map((r) => ({
        type: 'review_failed' as const,
        severity: 'error' as const,
        title: `Review failed for PR #${r.prNumber}`,
        description: r.prTitle,
        repoName: r.repository?.fullName ?? 'unknown',
        createdAt: r.createdAt.toISOString(),
      })),
    ]

    if (pendingReviews > 0) {
      alerts.unshift({
        type: 'reviews_pending' as const,
        severity: 'warning' as const,
        title: `${pendingReviews} review${pendingReviews > 1 ? 's' : ''} pending`,
        description: 'Reviews waiting to be processed',
        repoName: '',
        createdAt: new Date().toISOString(),
      })
    }

    return Response.json({
      alerts,
      totalFailed: failedReviews,
      totalPending: pendingReviews,
      total: alerts.length,
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch alerts',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
