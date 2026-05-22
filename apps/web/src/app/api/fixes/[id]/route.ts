import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { auth } from '@clerk/nextjs/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: clerkUserId } = await auth()
    if (!clerkUserId) {
      return Response.json(
        { error: 'User not authenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      )
    }

    const { id } = await params

    const fixRun = await prisma.fixRun.findUnique({
      where: { id },
      include: {
        repository: {
          select: { fullName: true, name: true, id: true },
        },
      },
    })

    if (!fixRun) {
      return Response.json({ error: 'Fix run not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    return Response.json({
      id: fixRun.id,
      repoName: fixRun.repository?.fullName ?? 'unknown',
      repoId: fixRun.repository?.id ?? null,
      issueId: fixRun.issueId,
      issueTitle: fixRun.issueTitle,
      status: fixRun.status,
      prUrl: fixRun.prUrl,
      branchName: fixRun.branchName,
      summary: fixRun.summary,
      rootCause: fixRun.rootCause,
      filesChanged: fixRun.filesChanged,
      error: fixRun.error,
      createdAt: fixRun.createdAt.toISOString(),
      updatedAt: fixRun.updatedAt.toISOString(),
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch fix run',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
