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

    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        repository: {
          select: { fullName: true, name: true },
        },
        findings: {
          select: {
            id: true,
            severity: true,
            file: true,
            line: true,
            quote: true,
            title: true,
            message: true,
            suggestion: true,
            postedToGitHub: true,
            skipReason: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!review) {
      return Response.json({ error: 'Review not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    return Response.json({
      id: review.id,
      repoName: review.repository?.fullName ?? 'unknown',
      repo: review.repository?.name ?? 'unknown',
      prNumber: review.prNumber,
      prTitle: review.prTitle,
      prUrl: review.prUrl,
      prBody: review.prBody,
      author: review.author,
      baseRef: review.baseRef,
      headRef: review.headRef,
      status: review.status,
      review: review.review,
      findings: review.findings,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to fetch review',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
