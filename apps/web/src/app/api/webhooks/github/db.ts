import prisma from '@/lib/db'
import type { Repository } from '@pfe-monorepo/github-api'
import type { InstallationSyncStatus, PullRequestPayload, PullRequestReviewDbStatus } from './types'

export type FindingInput = {
  severity: string
  file: string
  line?: number | null
  quote?: string | null
  title: string
  message: string
  suggestion?: string | null
  postedToGitHub: boolean
  skipReason?: string | null
}

type OwnerRepo = {
  owner: string
  repo: string
}

export const syncInstallationRepositories = async ({
  installationId,
  accountLogin,
  added,
  removed,
}: {
  installationId: number
  accountLogin?: string
  added: Repository[]
  removed: Repository[]
}): Promise<boolean> => {
  const installation = await prisma.githubInstallation.findUnique({
    where: { installationId },
    select: { id: true },
  })

  if (!installation) {
    return false
  }

  await prisma.$transaction(async (tx) => {
    if (accountLogin) {
      await tx.githubInstallation.update({
        where: { installationId },
        data: { accountLogin },
      })
    }

    if (added.length > 0) {
      await tx.repository.createMany({
        data: added.map((repo) => ({
          repoId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          installationId,
        })),
        skipDuplicates: true,
      })
    }

    if (removed.length > 0) {
      await tx.repository.deleteMany({
        where: {
          installationId,
          repoId: {
            in: removed.map((repo) => repo.id),
          },
        },
      })
    }
  })

  return true
}

export const syncInstallation = async ({
  action,
  installationId,
  accountLogin,
  repositories,
}: {
  action?: string
  installationId: number
  accountLogin?: string
  repositories: Repository[]
}): Promise<InstallationSyncStatus> => {
  if (action === 'deleted') {
    await prisma.$transaction([
      prisma.repository.deleteMany({
        where: {
          installationId,
        },
      }),
      prisma.githubInstallation.deleteMany({
        where: {
          installationId,
        },
      }),
    ])

    return 'installation_deleted'
  }

  const installation = await prisma.githubInstallation.findUnique({
    where: { installationId },
    select: { id: true },
  })

  if (!installation) {
    return 'ignored_installation_not_linked'
  }

  await prisma.$transaction(async (tx) => {
    if (accountLogin) {
      await tx.githubInstallation.update({
        where: { installationId },
        data: { accountLogin },
      })
    }

    if (repositories.length > 0) {
      await tx.repository.createMany({
        data: repositories.map((repo) => ({
          repoId: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          installationId,
        })),
        skipDuplicates: true,
      })
    }
  })

  return 'installation_synced'
}

export const getGithubInstallationReviewer = async (installationId: number) =>
  prisma.githubInstallation.findUnique({
    where: { installationId },
    select: {
      id: true,
      user: {
        select: {
          clerkUserId: true,
        },
      },
    },
  })

export const savePullRequestReview = async ({
  installationId,
  repository,
  ownerRepo,
  pullRequestNumber,
  pullRequestTitle,
  pullRequestUrl,
  prAuthor,
  prBody,
  headRef,
  baseRef,
  prState,
  prMerged,
  prDraft,
  reviewText,
  reviewerClerkUserId,
  findings,
}: {
  installationId: number
  repository?: PullRequestPayload['repository']
  ownerRepo: OwnerRepo
  pullRequestNumber: number
  pullRequestTitle: string
  pullRequestUrl: string
  prAuthor?: string | null
  prBody?: string | null
  headRef?: string | null
  baseRef?: string | null
  prState?: string | null
  prMerged?: boolean
  prDraft?: boolean
  reviewText: string
  reviewerClerkUserId: string
  findings?: FindingInput[]
}): Promise<PullRequestReviewDbStatus> => {
  const repositoryId = repository?.id

  const repositoryRecord =
    typeof repositoryId === 'number' && Number.isInteger(repositoryId)
      ? await prisma.repository.upsert({
          where: {
            repoId: repositoryId,
          },
          create: {
            repoId: repositoryId,
            name: repository?.name?.trim() || ownerRepo.repo,
            fullName: repository?.full_name?.trim() || `${ownerRepo.owner}/${ownerRepo.repo}`,
            private: repository?.private ?? true,
            installationId,
          },
          update: {
            name: repository?.name?.trim() || ownerRepo.repo,
            fullName: repository?.full_name?.trim() || `${ownerRepo.owner}/${ownerRepo.repo}`,
            private: repository?.private ?? true,
            installationId,
          },
          select: {
            id: true,
            repoId: true,
          },
        })
      : await prisma.repository.findFirst({
          where: {
            fullName: `${ownerRepo.owner}/${ownerRepo.repo}`,
            installationId,
          },
          select: {
            id: true,
            repoId: true,
          },
        })

  if (!repositoryRecord) {
    return 'skipped_repository_not_found'
  }

  await prisma.$transaction(async (tx) => {
    const review = await tx.review.upsert({
      where: {
        repositoryId_prNumber: {
          repositoryId: repositoryRecord.id,
          prNumber: pullRequestNumber,
        },
      },
      create: {
        repositoryId: repositoryRecord.id,
        repoId: repositoryRecord.repoId,
        prNumber: pullRequestNumber,
        prTitle: pullRequestTitle,
        prUrl: pullRequestUrl,
        prAuthor,
        prBody,
        headRef,
        baseRef,
        prState,
        prMerged,
        prDraft,
        review: reviewText,
        reviewerClerkUserId,
      },
      update: {
        prTitle: pullRequestTitle,
        prUrl: pullRequestUrl,
        prAuthor,
        prBody,
        headRef,
        baseRef,
        prState,
        prMerged,
        prDraft,
        review: reviewText,
        reviewerClerkUserId,
        status: 'completed',
      },
    })

    if (findings && findings.length > 0) {
      await tx.finding.deleteMany({ where: { reviewId: review.id } })
      await tx.finding.createMany({
        data: findings.map((f) => ({
          reviewId: review.id,
          severity: f.severity,
          file: f.file,
          line: f.line ?? null,
          quote: f.quote ?? null,
          title: f.title,
          message: f.message,
          suggestion: f.suggestion ?? null,
          postedToGitHub: f.postedToGitHub,
          skipReason: f.skipReason ?? null,
        })),
      })
    }
  })

  return 'saved'
}
