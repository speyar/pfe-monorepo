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
      return Response.json({ repos: [], monitoredCount: 0, totalRepos: 0 })
    }

    const whereClause = { installation: { clerkUserId: user.id } }

    const [repos, sentryLinks, totalSentryConnections] = await Promise.all([
      prisma.repository.findMany({
        where: whereClause,
        orderBy: { fullName: 'asc' },
        include: {
          sentryProject: {
            select: { sentryOrgSlug: true, sentryProjectSlug: true, enabled: true },
          },
        },
      }),
      prisma.repositorySentryProject.findMany({
        where: { repository: whereClause },
        orderBy: { createdAt: 'desc' },
        include: { repository: { select: { fullName: true } } },
      }),
      prisma.sentryConnection.count({ where: { userId: user.id } }),
    ])

    const data = repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      name: r.name,
      repoId: r.repoId,
      monitored: !!r.sentryProject,
      orgSlug: r.sentryProject?.sentryOrgSlug ?? null,
      projectSlug: r.sentryProject?.sentryProjectSlug ?? null,
      enabled: r.sentryProject?.enabled ?? false,
    }))

    const monitoredCount = data.filter((r) => r.monitored && r.enabled).length

    return Response.json({
      repos: data,
      totalRepos: data.length,
      monitoredCount,
      unmonitoredCount: data.length - monitoredCount,
      sentryConnected: totalSentryConnections > 0,
      recentLinks: sentryLinks.slice(0, 5).map((l) => ({
        repoName: l.repository.fullName,
        orgSlug: l.sentryOrgSlug,
        projectSlug: l.sentryProjectSlug,
        enabled: l.enabled,
        createdAt: l.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch monitoring data',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
