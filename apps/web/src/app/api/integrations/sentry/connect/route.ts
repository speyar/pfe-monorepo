import { cookies } from 'next/headers'
import { createOauthState, sentryOauthStateCookie } from '@/lib/sentry-oauth-state'
import { buildSentryOauthUrl } from '@/lib/sentry-api'
import { toAppError } from '@/lib/error'
import { requireCurrentUser } from '@/lib/current-user'

export async function GET() {
  console.info('[sentry] connect endpoint called')

  try {
    await requireCurrentUser()
    console.info('[sentry] user authenticated, creating OAuth state')

    const state = createOauthState()
    console.info('[sentry] OAuth state created', { statePreview: state.slice(0, 8) })

    const oauthUrl = buildSentryOauthUrl(state)
    const cookieStore = await cookies()

    cookieStore.set(sentryOauthStateCookie.name, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: sentryOauthStateCookie.maxAge,
      path: '/',
    })

    console.info('[sentry] OAuth state cookie set, redirecting', {
      maxAge: sentryOauthStateCookie.maxAge,
    })

    return Response.redirect(oauthUrl, 302)
  } catch (error) {
    console.error('[sentry] connect failed', {
      cause: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })

    const appError = toAppError(error, {
      message: 'Failed to initialize Sentry OAuth',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
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
