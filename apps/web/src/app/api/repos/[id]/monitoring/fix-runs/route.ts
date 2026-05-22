import { requireCurrentUser } from '@/lib/current-user'
import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { parseRepoId } from '../helpers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser()
    const { id } = await params
    const repoId = parseRepoId(id)

    const repository = await prisma.repository.findUnique({
      where: { repoId },
      select: { id: true },
    })

    if (!repository) {
      return Response.json({ error: 'Repository not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const fixRuns = await prisma.fixRun.findMany({
      where: { repositoryId: repository.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        issueId: true,
        issueTitle: true,
        status: true,
        prUrl: true,
        createdAt: true,
      },
    })

    return Response.json({
      data: fixRuns.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    })
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
