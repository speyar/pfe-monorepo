import { requireCurrentUser } from '@/lib/current-user'
import { toAppError } from '@/lib/error'
import { getAccessTokenForUser, listSentryOrganizations } from '@/lib/sentry-api'

export async function GET() {
  console.info('[sentry] organizations endpoint called')

  try {
    const user = await requireCurrentUser()
    console.info('[sentry] fetching orgs for user', { userId: user.id })

    const accessToken = await getAccessTokenForUser(user.id)
    const organizations = await listSentryOrganizations({ accessToken })

    console.info('[sentry] organizations fetched', { count: organizations.length })

    return Response.json({ data: organizations }, { status: 200 })
  } catch (error) {
    console.error('[sentry] organizations fetch failed', {
      cause: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })

    const appError = toAppError(error, {
      message: 'Failed to fetch Sentry organizations',
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
    })

    return Response.json(
      {
        error: appError.message,
        code: appError.code,
      },
      { status: appError.statusCode },
    )
  }
}
