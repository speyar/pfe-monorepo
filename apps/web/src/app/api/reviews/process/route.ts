import prisma from '@/lib/db'
import {
  runPullRequestReview,
  type Skill,
} from '@pfe-monorepo/new-review-agent'
import { toMarkdownReview } from '../../webhooks/github/helpers'
import { savePullRequestReview } from '../../webhooks/github/db'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  try {
    const job = await prisma.reviewJob.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    })

    if (!job) {
      return Response.json({ ok: true, message: 'No pending reviews' })
    }

    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: 'processing' },
    })

    console.log(`[review-process] Processing job ${job.id} for PR #${job.prNumber} in ${job.owner}/${job.repo}`)

    const filesForInput: Array<{ path: string; patch: string }> = []
    let initialDiff = job.initialDiff

    if (job.filesJson) {
      const files = job.filesJson as Array<{ path: string; patch: string }>
      for (const f of files) {
        filesForInput.push(f)
      }
      if (!initialDiff) {
        initialDiff = files.map((f) =>
          [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, f.patch].join('\n')
        ).join('\n\n')
      }
    }

    const installationId = job.installationId

    const skills: Skill[] = []
    if (job.clerkUserId) {
      const dbSkills = await prisma.skill.findMany({
        where: { userId: job.clerkUserId },
        select: { name: true, useCase: true, description: true, content: true, targetAgents: true },
      })
      skills.push(...dbSkills)
    }

    const review = await runPullRequestReview({
      installationId,
      owner: job.owner,
      repo: job.repo,
      headRef: job.headRef,
      baseRef: job.baseRef,
      initialDiff: initialDiff || undefined,
      files: filesForInput.length > 0 ? filesForInput : undefined,
    }, { skills })

    console.log(`[review-process] Job ${job.id} completed: ${review.findings.length} findings`)

    const reviewText = toMarkdownReview(review)
    const pullRequestUrl = job.prUrl

    const findingsForDb = review.findings.map((f) => ({
      severity: f.severity,
      file: f.file ?? 'unknown',
      line: f.line ?? null,
      quote: f.quote ?? null,
      title: f.title,
      message: f.message,
      suggestion: f.suggestion ?? null,
      postedToGitHub: false,
      skipReason: null,
    }))

    await savePullRequestReview({
      installationId,
      repository: { full_name: `${job.owner}/${job.repo}`, id: 0, name: job.repo, private: false },
      ownerRepo: { owner: job.owner, repo: job.repo },
      pullRequestNumber: job.prNumber,
      pullRequestTitle: job.prTitle,
      pullRequestUrl,
      prAuthor: job.prAuthor,
      prBody: job.prBody,
      headRef: job.headRef,
      baseRef: job.baseRef,
      prState: 'open',
      prMerged: false,
      prDraft: false,
      reviewText,
      reviewerClerkUserId: job.clerkUserId,
      findings: findingsForDb,
    })

    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: 'completed' },
    })

    return Response.json({
      ok: true,
      jobId: job.id,
      findingsCount: review.findings.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[review-process] Failed:', message)

    const failedJob = await prisma.reviewJob.findFirst({
      where: { status: 'processing' },
      orderBy: { updatedAt: 'desc' },
    })
    if (failedJob) {
      await prisma.reviewJob.update({
        where: { id: failedJob.id },
        data: { status: 'failed', error: message },
      })
    }

    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
