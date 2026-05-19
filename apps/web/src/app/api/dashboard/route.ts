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

    const user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    })
    if (!user) {
      return Response.json({ error: 'User not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const whereClause = {
      installation: { clerkUserId: user.id },
    }

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [
      reposCount,
      totalReviews,
      failedReviews,
      pendingReviews,
      reviewsThisWeek,
      activeMonitors,
      recentReviews,
      recentRepos,
      recentSentryLinks,
      recentFixRuns,
    ] = await Promise.all([
      prisma.repository.count({ where: whereClause }),
      prisma.review.count({ where: { repository: whereClause } }),
      prisma.review.count({ where: { repository: whereClause, status: 'failed' } }),
      prisma.review.count({ where: { repository: whereClause, status: 'pending' } }),
      prisma.review.count({
        where: { repository: whereClause, createdAt: { gte: oneWeekAgo } },
      }),
      prisma.repositorySentryProject.count({
        where: { enabled: true, repository: whereClause },
      }),
      prisma.review.findMany({
        where: { repository: whereClause },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          repository: {
            select: { fullName: true },
          },
        },
      }),
      prisma.repository.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { fullName: true, createdAt: true },
      }),
      prisma.repositorySentryProject.findMany({
        where: { repository: whereClause },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          repository: { select: { fullName: true } },
        },
      }),
      prisma.fixRun.findMany({
        where: { repository: whereClause },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          repository: { select: { fullName: true } },
        },
      }).catch(() => []),
    ])

    const reviewSuccessRate =
      totalReviews > 0
        ? Math.round(((totalReviews - failedReviews - pendingReviews) / totalReviews) * 100)
        : 0

    const reposWithMonitoring = activeMonitors
    const reposWithoutMonitoring = reposCount - reposWithMonitoring

    const reviews = recentReviews.map((r) => ({
      id: r.id,
      prTitle: r.prTitle,
      prNumber: r.prNumber,
      repoName: r.repository?.fullName ?? 'unknown',
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }))

    const activity: { type: string; message: string; createdAt: string }[] = [
      ...recentReviews.map((r) => ({
        type: 'review' as const,
        message: `Reviewed PR #${r.prNumber} on ${r.repository?.fullName ?? 'unknown'}`,
        createdAt: r.createdAt.toISOString(),
      })),
      ...recentRepos.map((r) => ({
        type: 'repo' as const,
        message: `Connected repository ${r.fullName}`,
        createdAt: r.createdAt.toISOString(),
      })),
      ...recentSentryLinks.map((l) => ({
        type: 'monitor' as const,
        message: `Monitoring enabled for ${l.repository.fullName}`,
        createdAt: l.createdAt.toISOString(),
      })),
      ...recentFixRuns.map((f) => ({
        type: 'fix' as const,
        message: f.status === 'success'
          ? `Auto-fix applied for "${f.issueTitle}" on ${f.repository.fullName}`
          : f.status === 'failed'
            ? `Auto-fix failed for "${f.issueTitle}" on ${f.repository.fullName}`
            : `Auto-fix running for "${f.issueTitle}" on ${f.repository.fullName}`,
        createdAt: f.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)

    return Response.json({
      reposCount,
      totalReviews,
      failedReviews,
      pendingReviews,
      reviewSuccessRate,
      reviewsThisWeek,
      activeMonitors,
      reposWithMonitoring,
      reposWithoutMonitoring,
      recentReviews: reviews,
      recentActivity: activity,
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch dashboard data',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
