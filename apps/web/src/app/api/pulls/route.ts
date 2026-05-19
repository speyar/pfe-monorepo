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
      return Response.json({ data: [], total: 0 })
    }

    const whereClause = { repository: { installation: { clerkUserId: user.id } } }

    const reviews = await prisma.review.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { repository: { select: { fullName: true, name: true } } },
    })

    const pullsMap = new Map<string, (typeof reviews)[number]>()
    for (const r of reviews) {
      const key = `${r.repository?.fullName ?? 'unknown'}/${r.prNumber}`
      if (!pullsMap.has(key)) {
        pullsMap.set(key, r)
      }
    }

    const data = Array.from(pullsMap.values()).map((r) => ({
      id: r.id,
      repoName: r.repository?.fullName ?? 'unknown',
      repo: r.repository?.name ?? 'unknown',
      prNumber: r.prNumber,
      prTitle: r.prTitle,
      prUrl: r.prUrl,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }))

    return Response.json({ data, total: data.length })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch pull requests',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
