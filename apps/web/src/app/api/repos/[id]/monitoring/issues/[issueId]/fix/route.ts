import { requireCurrentUser } from '@/lib/current-user'
import prisma from '@/lib/db'
import { toAppError } from '@/lib/error'
import { getAccessTokenForUser, getLatestSentryEvent } from '@/lib/sentry-api'
import type { SentryIssue } from '@/lib/sentry-api'
import { getOwnedRepository, parseRepoId } from '../../../helpers'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  let fixRunId: string | null = null

  try {
    const user = await requireCurrentUser()
    const { id, issueId } = await params
    const repoId = parseRepoId(id)
    const repository = await getOwnedRepository({ repoId, userId: user.id })

    const body = (await request.json()) as { issue?: SentryIssue } | null
    const issueFromBody = body?.issue

    const repoWithInstallation = await prisma.repository.findUnique({
      where: { id: repository.id },
      select: {
        fullName: true,
        installationId: true,
      },
    })

    if (!repoWithInstallation) {
      return Response.json({ error: 'Repository not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const mapping = await prisma.repositorySentryProject.findUnique({
      where: { repositoryId: repository.id },
      select: {
        sentryOrgSlug: true,
        sentryProjectSlug: true,
        environment: true,
        enabled: true,
      },
    })

    if (!mapping || !mapping.enabled) {
      return Response.json(
        { error: 'Repository is not linked to a Sentry project', code: 'NOT_FOUND' },
        { status: 404 },
      )
    }

    const accessToken = await getAccessTokenForUser(user.id)

    const eventJson = await getLatestSentryEvent({
      accessToken,
      orgSlug: mapping.sentryOrgSlug,
      projectSlug: mapping.sentryProjectSlug,
      issueId,
    })

    const [owner, repo] = repoWithInstallation.fullName.split('/')

    const fixRun = await prisma.fixRun.create({
      data: {
        issueId,
        issueTitle: issueFromBody?.title ?? 'Unknown issue',
        repoId: repository.id,
        repositoryId: repository.id,
        status: 'running',
      },
    })
    fixRunId = fixRun.id

    const { runSentryFix } = await import('@pfe-monorepo/mechanic-agent')

    const result = await runSentryFix(
      {
        issue: {
          id: issueId,
          title: issueFromBody?.title ?? '',
          level: issueFromBody?.level ?? '',
          status: issueFromBody?.status ?? '',
          count: issueFromBody?.count ?? '',
          userCount: issueFromBody?.userCount ?? 0,
          culprit: issueFromBody?.culprit ?? '',
          permalink: issueFromBody?.permalink ?? '',
          firstSeen: issueFromBody?.firstSeen ?? '',
          lastSeen: issueFromBody?.lastSeen ?? '',
        },
        repo: {
          owner: owner ?? '',
          repo: repo ?? '',
          installationId: repoWithInstallation.installationId,
        },
        eventJson: eventJson ?? undefined,
      },
      {
        repositoryUrl: `https://github.com/${repoWithInstallation.fullName}.git`,
      },
    )

    await prisma.fixRun.update({
      where: { id: fixRun.id },
      data: {
        status: result.success ? 'success' : 'failed',
        prUrl: result.prUrl ?? undefined,
        branchName: result.branchName ?? undefined,
        summary: result.fix?.summary ?? undefined,
        rootCause: result.fix?.rootCause ?? undefined,
        filesChanged: result.fix?.filesChanged ?? undefined,
        error: result.error ?? undefined,
      },
    })

    return Response.json(result, {
      status: result.success ? 200 : 500,
    })
  } catch (error) {
    if (fixRunId) {
      await prisma.fixRun.update({
        where: { id: fixRunId },
        data: { status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' },
      }).catch(() => {})
    }

    const appError = toAppError(error, {
      message: 'Failed to run fix agent',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    })

    return Response.json(
      { error: appError.message, code: appError.code },
      { status: appError.statusCode },
    )
  }
}
