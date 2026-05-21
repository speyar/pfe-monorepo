import { decryptText, encryptText } from '@/lib/crypto'
import prisma from '@/lib/db'
import { AppError } from '@/lib/error'

const SENTRY_OAUTH_BASE_URL = process.env.SENTRY_OAUTH_BASE_URL ?? 'https://sentry.io'
const SENTRY_API_BASE_URL =
  process.env.SENTRY_API_BASE_URL ?? process.env.SENTRY_BASE_URL ?? 'https://sentry.io'

export type SentryProject = {
  id: string
  slug: string
  name: string
  platform: string | null
}

export type SentryOrganization = {
  id: string
  slug: string
  name: string
}

export type SentryIssue = {
  id: string
  title: string
  level: string
  status: string
  count: string
  userCount: number
  permalink: string
  culprit: string
  firstSeen: string
  lastSeen: string
}

export type SentryIssueListResponse = {
  data: SentryIssue[]
  nextCursor: string | null
}

type SentryConnectionRecord = {
  accessTokenCipher: string
  tokenType: string
}

export function buildSentryOauthUrl(state: string): string {
  const clientId = process.env.SENTRY_CLIENT_ID
  const redirectUri = process.env.SENTRY_REDIRECT_URI

  console.info('[sentry] buildSentryOauthUrl', {
    hasClientId: Boolean(clientId),
    hasRedirectUri: Boolean(redirectUri),
    redirectUri,
    oauthBaseUrl: SENTRY_OAUTH_BASE_URL,
    apiBaseUrl: SENTRY_API_BASE_URL,
    statePreview: state.slice(0, 8),
  })

  if (!clientId || !redirectUri) {
    console.error('[sentry] Missing Sentry OAuth configuration', {
      clientId: Boolean(clientId),
      redirectUri: Boolean(redirectUri),
    })
    throw new AppError({
      message: 'Missing Sentry OAuth configuration',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'org:read project:read event:read',
    state,
  })

  const url = `${SENTRY_OAUTH_BASE_URL}/oauth/authorize/?${params.toString()}`
  console.info('[sentry] redirecting to OAuth URL', { url: url.slice(0, 120) })
  return url
}

export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string
  tokenType: string
  scope?: string
}> {
  const clientId = process.env.SENTRY_CLIENT_ID
  const clientSecret = process.env.SENTRY_CLIENT_SECRET
  const redirectUri = process.env.SENTRY_REDIRECT_URI

  console.info('[sentry] exchangeCodeForToken', {
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasRedirectUri: Boolean(redirectUri),
    redirectUri,
    oauthTokenUrl: `${SENTRY_OAUTH_BASE_URL}/oauth/token/`,
  })

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('[sentry] Missing Sentry OAuth config for token exchange', {
      clientId: Boolean(clientId),
      clientSecret: Boolean(clientSecret),
      redirectUri: Boolean(redirectUri),
    })
    throw new AppError({
      message: 'Missing Sentry OAuth configuration',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    })
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  const response = await fetch(`${SENTRY_OAUTH_BASE_URL}/oauth/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  console.info('[sentry] token exchange response', {
    status: response.status,
    ok: response.ok,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload.access_token !== 'string') {
    console.error('[sentry] token exchange failed', {
      status: response.status,
      payload,
    })
    throw new AppError({
      message: 'Failed to exchange Sentry OAuth code',
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
      details: payload,
    })
  }

  console.info('[sentry] token exchange success', {
    tokenType: payload.token_type,
    hasScope: Boolean(payload.scope),
    scope: payload.scope,
  })

  return {
    accessToken: payload.access_token,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
  }
}

export async function getSentryUser(accessToken: string): Promise<{
  id: string | null
  email: string | null
}> {
  console.info('[sentry] getSentryUser', {
    apiUrl: `${SENTRY_API_BASE_URL}/api/0/users/me/`,
  })

  const response = await fetch(`${SENTRY_API_BASE_URL}/api/0/users/me/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })

  console.info('[sentry] user fetch response', { status: response.status, ok: response.ok })

  const rawText = await response.text()
  let payload: Record<string, unknown> | null = null

  if (rawText.trim().length > 0) {
    payload = JSON.parse(rawText) as Record<string, unknown>
  }

  if (!response.ok || !payload) {
    console.error('[sentry] failed to fetch Sentry user', { status: response.status, payload })
    throw new AppError({
      message: 'Failed to fetch Sentry user',
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
      details: payload,
    })
  }

  console.info('[sentry] user fetch success', {
    id: payload?.id,
    email: payload?.email,
  })

  return {
    id: typeof payload?.id === 'string' ? payload.id : null,
    email: typeof payload?.email === 'string' ? payload.email : null,
  }
}

export async function upsertSentryConnection(args: {
  userId: string
  accessToken: string
  tokenType: string
  scope?: string
  sentryUserId?: string | null
  sentryEmail?: string | null
}) {
  const accessTokenCipher = encryptText(args.accessToken)

  await prisma.sentryConnection.upsert({
    where: { userId: args.userId },
    create: {
      userId: args.userId,
      accessTokenCipher,
      tokenType: args.tokenType,
      scope: args.scope,
      sentryUserId: args.sentryUserId,
      sentryEmail: args.sentryEmail,
    },
    update: {
      accessTokenCipher,
      tokenType: args.tokenType,
      scope: args.scope,
      sentryUserId: args.sentryUserId,
      sentryEmail: args.sentryEmail,
    },
  })
}

export async function getSentryConnectionByUserId(
  userId: string,
): Promise<SentryConnectionRecord | null> {
  return prisma.sentryConnection.findUnique({
    where: { userId },
    select: {
      accessTokenCipher: true,
      tokenType: true,
    },
  })
}

async function sentryFetch<T>(args: {
  accessToken: string
  path: string
  searchParams?: URLSearchParams
}): Promise<{ data: T; headers: Headers }> {
  const url = new URL(`${SENTRY_API_BASE_URL}${args.path}`)
  if (args.searchParams) {
    url.search = args.searchParams.toString()
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 60 },
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || payload === null) {
    throw new AppError({
      message: 'Failed to fetch from Sentry API',
      code: 'EXTERNAL_SERVICE_ERROR',
      statusCode: 502,
      details: payload,
    })
  }

  return { data: payload as T, headers: response.headers }
}

export async function listSentryProjects(args: {
  accessToken: string
  orgSlug: string
}): Promise<SentryProject[]> {
  const response = await sentryFetch<
    Array<{ id: string; slug: string; name: string; platform: string | null }>
  >({
    accessToken: args.accessToken,
    path: `/api/0/organizations/${args.orgSlug}/projects/`,
  })

  return response.data.map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    platform: project.platform,
  }))
}

export async function listSentryOrganizations(args: {
  accessToken: string
}): Promise<SentryOrganization[]> {
  const response = await sentryFetch<Array<{ id: string; slug: string; name: string }>>({
    accessToken: args.accessToken,
    path: '/api/0/organizations/',
  })

  return response.data.map((organization) => ({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
  }))
}

function parseNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null
  }

  const segments = linkHeader.split(',').map((part) => part.trim())
  const nextSegment = segments.find((segment) => segment.includes('rel="next"'))

  if (!nextSegment || nextSegment.includes('results="false"')) {
    return null
  }

  const cursorMatch = /[?&]cursor=([^&>]+)/.exec(nextSegment)
  return cursorMatch ? decodeURIComponent(cursorMatch[1]) : null
}

export async function listSentryIssues(args: {
  accessToken: string
  orgSlug: string
  projectSlug: string
  environment?: string
  status?: string
  query?: string
  statsPeriod?: string
  cursor?: string
}): Promise<SentryIssueListResponse> {
  const searchParams = new URLSearchParams()

  if (args.statsPeriod) {
    searchParams.set('statsPeriod', args.statsPeriod)
  }

  if (args.environment) {
    searchParams.set('environment', args.environment)
  }

  if (args.status) {
    searchParams.set('query', `is:${args.status}${args.query ? ` ${args.query}` : ''}`)
  } else if (args.query) {
    searchParams.set('query', args.query)
  }

  if (args.cursor) {
    searchParams.set('cursor', args.cursor)
  }

  const response = await sentryFetch<
    Array<{
      id: string
      title: string
      level: string
      status: string
      count: string
      userCount: number
      permalink: string
      culprit: string
      firstSeen: string
      lastSeen: string
    }>
  >({
    accessToken: args.accessToken,
    path: `/api/0/projects/${args.orgSlug}/${args.projectSlug}/issues/`,
    searchParams,
  })

  return {
    data: response.data,
    nextCursor: parseNextCursor(response.headers.get('link')),
  }
}

export async function getLatestSentryEvent(args: {
  accessToken: string
  orgSlug: string
  projectSlug: string
  issueId: string
}): Promise<string | null> {
  const response = await fetch(
    `${SENTRY_API_BASE_URL}/api/0/issues/${args.issueId}/events/latest/`,
    {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  )

  if (!response.ok) {
    return null
  }

  return response.text()
}

export async function getAccessTokenForUser(userId: string): Promise<string> {
  console.info('[sentry] getAccessTokenForUser', { userId })

  const connection = await getSentryConnectionByUserId(userId)
  if (!connection) {
    console.warn('[sentry] no connection found for user', { userId })
    throw new AppError({
      message: 'Sentry is not connected for this user',
      code: 'NOT_FOUND',
      statusCode: 404,
    })
  }

  const token = decryptText(connection.accessTokenCipher)
  console.info('[sentry] access token retrieved', { userId, tokenPreview: token.slice(0, 8) })
  return token
}
