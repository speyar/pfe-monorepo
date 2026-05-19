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

    const connection = await prisma.sentryConnection.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })

    return Response.json({ connected: !!connection })
  } catch (error) {
    const appError = toAppError(error, {
      message: 'Failed to check Sentry connection status',
      code: 'DATABASE_ERROR',
      statusCode: 500,
    })
    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
