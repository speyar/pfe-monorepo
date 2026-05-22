import prisma from '@/lib/db'
import { generateText, type LanguageModel } from 'ai'
import { createOpenaiCompatible } from '@ceira/better-copilot-provider'
import { upsertPullRequestComment } from '@pfe-monorepo/github-api'
import { REVIEW_COMMENT_MARKER } from '../../webhooks/github/helpers'
const REVIEW_STATUS_MARKER = '<!-- pfe-review-agent-status -->'
import { savePullRequestReview } from '../../webhooks/github/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const REVIEW_SYSTEM_PROMPT = [
  'You are a PR review agent. Analyze the provided diffs and find real problems.',
  'Focus on: bugs, breaking changes, security issues, data integrity, production risks.',
  'Be specific. Include file paths and line numbers.',
  '',
  'Output a SINGLE JSON object with a "findings" array. Each finding has:',
  '- severity: "critical" | "high" | "medium" | "low" | "info"',
  '- file: string (path)',
  '- line: number (optional)',
  '- quote: string (optional, exact code)',
  '- title: string (short, specific)',
  '- message: string (what and why)',
  '- suggestion: string (optional, concrete fix)',
  '',
  'Example:',
  '{"findings":[{"severity":"high","file":"src/a.ts","line":42,"title":"Null dereference","message":"..."}]}',
  'Output ONLY the JSON. No markdown fences, no preamble.',
].join('\n')

function getModel() {
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (deepseekKey) {
    const provider = createOpenaiCompatible({
      apiKey: deepseekKey,
      baseURL: (process.env.DEEPSEEK_BASE_URL ?? 'https://opencode.ai/zen/go/v1').trim(),
      name: 'deepseek',
    })
    return provider((process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash').trim())
  }
  const copilotToken = process.env.COPILOT_GITHUB_TOKEN
  if (!copilotToken) throw new Error('No API key configured')
  const provider = createOpenaiCompatible({
    apiKey: copilotToken,
    baseURL: process.env.COPILOT_BASE_URL ?? 'https://api.githubcopilot.com',
    name: 'copilot',
  })
  return provider(process.env.REVIEW_MODEL ?? 'gpt-5.4-mini')
}

function parseReviewJson(text: string): { findings: Array<{ severity: string; file?: string; line?: number; quote?: string; title: string; message: string; suggestion?: string }> } {
  const cleaned = text.trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { findings: [] }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (Array.isArray(parsed.findings)) return parsed
    return { findings: [] }
  } catch {
    return { findings: [] }
  }
}

async function runDiffReview(
  model: LanguageModel,
  initialDiff: string,
  fileCount: number,
  subFindingsContext?: string,
) {
  const prompt = [
    `Changed files: ${fileCount}`,
    '',
    subFindingsContext ? `Sub-agent findings:\n${subFindingsContext}\n\nValidate, deduplicate, and add any missed findings.` : '',
    '',
    'Full diff:',
    initialDiff.slice(0, 100000),
    initialDiff.length > 100000 ? `\n... [truncated ${initialDiff.length - 100000} chars]` : '',
    '',
    'Analyze and output findings.',
  ].filter(Boolean).join('\n')

  const result = await generateText({ model, system: REVIEW_SYSTEM_PROMPT, prompt })
  return parseReviewJson(result.text ?? '')
}

async function runSubReview(model: LanguageModel, files: Array<{ path: string; patch: string }>, batchName: string) {
  const fileList = files.map(f => f.path)
  const diffText = files.map(f =>
    [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, f.patch].join('\n')
  ).join('\n\n')

  console.log(`[sub-review/${batchName}] ${files.length} files, ${Math.round(diffText.length / 1024)}KB`)

  const prompt = [
    `Your batch (${files.length} files):`,
    fileList.join('\n'),
    '',
    'Diffs:',
    diffText,
    '',
    'Output findings for YOUR batch only.',
  ].join('\n')

  const result = await generateText({ model, system: REVIEW_SYSTEM_PROMPT, prompt })
  return parseReviewJson(result.text ?? '').findings
}

export async function POST(request: Request) {
  const url = new URL(request.url)

  if (url.searchParams.get('action') === 'skip-big') {
    const bigJob = await prisma.reviewJob.findFirst({
      where: { status: 'processing' },
      orderBy: { createdAt: 'asc' },
    })
    if (bigJob) {
      await prisma.reviewJob.update({ where: { id: bigJob.id }, data: { status: 'failed', error: 'Skipped' } })
      return Response.json({ ok: true, skipped: bigJob.id })
    }
    return Response.json({ ok: true, message: 'none to skip' })
  }

  const job = await prisma.reviewJob.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  })

  if (!job) return Response.json({ ok: true, message: 'No pending reviews' })

  await prisma.reviewJob.update({ where: { id: job.id }, data: { status: 'processing' } })
  console.log(`[process] Job ${job.id} PR #${job.prNumber} ${job.owner}/${job.repo}`)

  const model = getModel()
  let allFindings: Array<{ severity: string; file?: string; line?: number; quote?: string; title: string; message: string; suggestion?: string }> = []

  try {
    let files: Array<{ path: string; patch: string }> = []
    let initialDiff = job.initialDiff

    if (job.filesJson) {
      files = job.filesJson as Array<{ path: string; patch: string }>
      if (!initialDiff) {
        initialDiff = files.map(f =>
          [`diff --git a/${f.path} b/${f.path}`, `--- a/${f.path}`, `+++ b/${f.path}`, f.patch].join('\n')
        ).join('\n\n')
      }
    }

    const subFindings: Array<{ severity: string; file?: string; title: string; message: string }> = []
    const BATCH_SIZE = 15
    const MAX_BATCHES = 5

    if (files.length > 30) {
      console.log(`[process] Fan-out: ${files.length} files in ${Math.ceil(files.length / BATCH_SIZE)} batches`)
      const batches: Array<Array<{ path: string; patch: string }>> = []
      for (let i = 0; i < files.length && batches.length < MAX_BATCHES; i += BATCH_SIZE) {
        batches.push(files.slice(i, i + BATCH_SIZE))
      }

      const batchResults = await Promise.all(
        batches.map((batch, i) => runSubReview(model, batch, `${i + 1}/${batches.length}`).catch(e => {
          console.log(`[process] Batch ${i + 1} failed: ${e.message}`)
          return [] as typeof subFindings
        }))
      )

      batchResults.forEach(fs => subFindings.push(...fs))
      console.log(`[process] Sub-agents: ${subFindings.length} findings`)
    }

    const subContext = subFindings.length > 0
      ? subFindings.map(f => `[${f.severity}] ${f.file ?? '?'} — ${f.title}${f.message ? ': ' + f.message.slice(0, 150) : ''}`).join('\n')
      : undefined

    const review = await runDiffReview(model, initialDiff, files.length || 1, subContext)
    allFindings = review.findings
    console.log(`[process] Review complete: ${allFindings.length} findings`)

    const reviewText = [
      '## Automated Review',
      '',
      `**${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''}**`,
      '',
      ...allFindings.map((f, i) => {
        const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '?'
        return [
          `### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`,
          `**Location:** ${loc}`,
          f.quote ? `\`\`\`\n${f.quote}\n\`\`\`` : '',
          f.message,
          f.suggestion ? `\n**Suggestion:** ${f.suggestion}` : '',
          '---',
        ].filter(Boolean).join('\n\n')
      }),
    ].join('\n\n')

    const findingsForDb = allFindings.map(f => ({
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
      installationId: job.installationId,
      repository: { full_name: `${job.owner}/${job.repo}`, id: 0, name: job.repo, private: false },
      ownerRepo: { owner: job.owner, repo: job.repo },
      pullRequestNumber: job.prNumber,
      pullRequestTitle: job.prTitle,
      pullRequestUrl: job.prUrl,
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

    await upsertPullRequestComment(job.installationId, {
      owner: job.owner,
      repo: job.repo,
      pullRequestNumber: job.prNumber,
      marker: REVIEW_COMMENT_MARKER,
      body: [REVIEW_STATUS_MARKER, '✅ Review completed.', '', reviewText].join('\n'),
    }).catch(e => console.log('[process] Failed to post comment:', e.message))

    await prisma.reviewJob.update({ where: { id: job.id }, data: { status: 'completed' } })
    console.log(`[process] Job ${job.id} done`)

    return Response.json({ ok: true, jobId: job.id, findingsCount: allFindings.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[process] Job ${job.id} failed: ${msg}`)

    await upsertPullRequestComment(job.installationId, {
      owner: job.owner, repo: job.repo, pullRequestNumber: job.prNumber,
      marker: REVIEW_STATUS_MARKER,
      body: `${REVIEW_STATUS_MARKER}\n⚠️ Review failed: ${msg}`,
    }).catch(() => {})

    await prisma.reviewJob.update({ where: { id: job.id }, data: { status: 'failed', error: msg } })
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}
