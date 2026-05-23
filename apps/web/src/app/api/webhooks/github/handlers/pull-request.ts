import {
  createCheckRun,
  createPullRequestReviewComment,
  getPullRequest,
  listPullRequestFiles,
  updateCheckRun,
  upsertPullRequestComment,
} from '@pfe-monorepo/github-api'
import {
  runPullRequestReview,
  summarizeDiffWithDefaultModel,
  type PullRequestReviewFinding as ReviewFinding,
  type PullRequestReviewResult as ReviewResult,
  type Skill,
} from '@pfe-monorepo/new-review-agent'
import { getGithubInstallationByRepoFullName, getGithubInstallationReviewer, savePullRequestReview } from '../db'
import prisma from '@/lib/db'
import {
  getInstallationId,
  getOwnerRepo,
  REVIEW_COMMENT_MARKER,
  toMarkdownReview,
} from '../helpers'
import type { PullRequestPayload } from '../types'

type HandlePullRequestEventArgs = {
  payload: unknown
  deliveryId: string
  eventName: string
}

type DiffSide = 'LEFT' | 'RIGHT'

type DiffLineMaps = {
  right: Map<number, string>
  left: Map<number, string>
}

type InlineTarget = {
  path: string
  line: number
  side: DiffSide
  matchedBy: 'quote' | 'line'
  snippet: string[]
}

type InlineTargetResolution = { ok: true; target: InlineTarget } | { ok: false; reason: string }

const MAX_INLINE_SNIPPET_LINES = 5
const REVIEW_STATUS_MARKER = '<!-- pfe-review-agent-status -->'
const MIN_INLINE_CONFIDENCE = 0.5

function buildReviewStatusComment(state: 'in_progress' | 'completed' | 'failed'): string {
  if (state === 'completed') {
    return [REVIEW_STATUS_MARKER, '✅ Review completed. See review below.'].join('\n')
  }

  if (state === 'failed') {
    return [REVIEW_STATUS_MARKER, '⚠️ Review failed before completion. Please retry.'].join('\n')
  }

  return [REVIEW_STATUS_MARKER, '⏳ AI review in progress'].join('\n')
}

function buildCheckSummary(lines: string[]): string {
  return lines.join('\n')
}

function looksLikeCode(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  const wordCount = trimmed.split(/\s+/).length
  const startsLikeSentence = /^[A-Z][a-z]+(\s|$)/.test(trimmed)
  const hasInlineCodeTicks = trimmed.includes('`')
  const startsLikeCode =
    /^(if|for|while|switch|return|const|let|var|await|throw|import|export|function|class)\b/.test(
      trimmed,
    ) || /^[A-Za-z_$][\w$.\]]*\s*(=|\+=|-=|\*=|\/=|\(|\[)/.test(trimmed)
  const endsLikeCode = /[;{}]$/.test(trimmed)

  if (startsLikeSentence && wordCount >= 5 && !endsLikeCode) {
    return false
  }

  if (hasInlineCodeTicks && startsLikeSentence) {
    return false
  }

  return startsLikeCode || endsLikeCode
}

function extractCodeFromSuggestion(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const hrefMatch = /^change\s+href\s+to\s+["']([^"']+)["']/i.exec(trimmed)
  if (hrefMatch) {
    return `href="${hrefMatch[1]}"`
  }

  const srcMatch = /^update\s+src\s+to\s+["']([^"']+)["']/i.exec(trimmed)
  if (srcMatch) {
    return `src="${srcMatch[1]}"`
  }

  const callMatch = /^call\s+([A-Za-z_$][\w$]*\([^)]*\))/i.exec(trimmed)
  if (callMatch) {
    return callMatch[1]
  }

  const passMatch = /^pass\s+([A-Za-z_$][\w$]*)\s+to\s+([A-Za-z_$][\w$]*)/i.exec(trimmed)
  if (passMatch) {
    return `${passMatch[2]}(${passMatch[1]})`
  }

  const backtickMatches = [...trimmed.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)

  const backtickCode = backtickMatches.find((candidate) => {
    if (!/[A-Za-z_$]/.test(candidate)) {
      return false
    }

    return /[().=!+\-/*\[\]{}'"<>]|\./.test(candidate)
  })

  if (backtickCode) {
    return backtickCode
  }

  if (looksLikeCode(trimmed)) {
    return trimmed
  }

  return null
}

function formatSuggestionSection(suggestion: string): string {
  const normalized = suggestion.trim()
  if (!normalized) {
    return ''
  }

  const lineCount = normalized.split(/\r?\n/).length

  if (lineCount === 1) {
    const codeCandidate = extractCodeFromSuggestion(normalized)
    if (codeCandidate) {
      return ['```suggestion', codeCandidate, '```'].join('\n')
    }
  }

  return normalized
}

function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/^[ab]\//, '')
    .replace(/:\d+(?::\d+)?$/, '')
}

function resolvePatchPath(
  patchByPath: Map<string, string>,
  rawPath: string,
): { path: string; patch: string } | null {
  const normalizedPath = normalizePath(rawPath)
  const directPatch = patchByPath.get(normalizedPath)
  if (directPatch) {
    return { path: normalizedPath, patch: directPatch }
  }

  const keys = [...patchByPath.keys()]
  const normalizedPathLower = normalizedPath.toLowerCase()

  const caseInsensitiveMatch = keys.find((key) => key.toLowerCase() === normalizedPathLower)
  if (caseInsensitiveMatch) {
    return {
      path: caseInsensitiveMatch,
      patch: patchByPath.get(caseInsensitiveMatch) ?? '',
    }
  }

  const suffixMatches = keys.filter((key) => {
    const keyLower = key.toLowerCase()
    return (
      keyLower.endsWith(`/${normalizedPathLower}`) || normalizedPathLower.endsWith(`/${keyLower}`)
    )
  })
  if (suffixMatches.length === 1) {
    const onlyMatch = suffixMatches[0]
    return {
      path: onlyMatch,
      patch: patchByPath.get(onlyMatch) ?? '',
    }
  }

  const basename = normalizedPathLower.split('/').pop()
  if (!basename) {
    return null
  }

  const basenameMatches = keys.filter((key) => {
    const keyLower = key.toLowerCase()
    return keyLower === basename || keyLower.endsWith(`/${basename}`)
  })
  if (basenameMatches.length === 1) {
    const onlyMatch = basenameMatches[0]
    return {
      path: onlyMatch,
      patch: patchByPath.get(onlyMatch) ?? '',
    }
  }

  return null
}

function normalizeCodeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function chooseClosestLine(lines: number[], preferredLine?: number): number | undefined {
  if (lines.length === 0) {
    return undefined
  }

  if (typeof preferredLine !== 'number') {
    return lines[0]
  }

  return lines.reduce((closest, current) => {
    const currentDistance = Math.abs(current - preferredLine)
    const closestDistance = Math.abs(closest - preferredLine)

    return currentDistance < closestDistance ? current : closest
  }, lines[0])
}

function findLineByQuote(
  sideMap: Map<number, string>,
  quote: string,
  preferredLine?: number,
): number | undefined {
  const quoteTrimmed = quote.trim()
  if (!quoteTrimmed) {
    return undefined
  }

  const exactMatches: number[] = []
  const normalizedMatches: number[] = []
  const includeMatches: number[] = []
  const normalizedQuote = normalizeCodeForComparison(quoteTrimmed)
  const normalizedQuoteLower = normalizedQuote.toLowerCase()

  for (const [lineNumber, rawLine] of sideMap.entries()) {
    const content = rawLine.slice(1)
    const contentTrimmed = content.trim()
    if (!contentTrimmed) {
      continue
    }

    if (contentTrimmed === quoteTrimmed) {
      exactMatches.push(lineNumber)
      continue
    }

    const normalizedContent = normalizeCodeForComparison(contentTrimmed)
    if (normalizedContent === normalizedQuote) {
      normalizedMatches.push(lineNumber)
      continue
    }

    const normalizedContentLower = normalizedContent.toLowerCase()
    if (
      normalizedContentLower.includes(normalizedQuoteLower) ||
      normalizedQuoteLower.includes(normalizedContentLower)
    ) {
      includeMatches.push(lineNumber)
    }
  }

  return (
    chooseClosestLine(exactMatches, preferredLine) ??
    chooseClosestLine(normalizedMatches, preferredLine) ??
    chooseClosestLine(includeMatches, preferredLine)
  )
}

function parsePatchLineMaps(patch: string): DiffLineMaps {
  const right = new Map<number, string>()
  const left = new Map<number, string>()

  const lines = patch.split(/\r?\n/)
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const rawLine of lines) {
    const hunkHeader = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(rawLine)

    if (hunkHeader) {
      oldLine = Number.parseInt(hunkHeader[1], 10)
      newLine = Number.parseInt(hunkHeader[2], 10)
      inHunk = true
      continue
    }

    if (!inHunk) {
      continue
    }

    if (!rawLine) {
      continue
    }

    const marker = rawLine[0]

    if (marker === '+') {
      right.set(newLine, rawLine)
      newLine += 1
      continue
    }

    if (marker === '-') {
      left.set(oldLine, rawLine)
      oldLine += 1
      continue
    }

    if (marker === ' ') {
      right.set(newLine, rawLine)
      left.set(oldLine, rawLine)
      oldLine += 1
      newLine += 1
    }
  }

  return { right, left }
}

function buildSnippet(sideMap: Map<number, string>, targetLine: number): string[] {
  const snippet: string[] = []

  for (let offset = -1; offset <= 1; offset += 1) {
    const lineNumber = targetLine + offset
    const line = sideMap.get(lineNumber)

    if (!line) {
      continue
    }

    const marker = line[0] === '+' || line[0] === '-' || line[0] === ' ' ? line[0] : ' '
    const content = line.slice(1)

    snippet.push(`${lineNumber.toString().padStart(4, ' ')} ${marker} ${content}`)
    if (snippet.length >= MAX_INLINE_SNIPPET_LINES) {
      break
    }
  }

  return snippet
}

function buildInlineCommentBody(finding: ReviewFinding, target: InlineTarget): string {
  const severityEmoji =
    finding.severity === "critical" ? "🚨" :
    finding.severity === "high" ? "⚠️" :
    finding.severity === "medium" ? "🔶" :
    finding.severity === "low" ? "🔹" :
    "ℹ️";

  const header = `**${severityEmoji} [${finding.severity.toUpperCase()}] ${finding.title}**`;

  const snippetSection =
    target.snippet.length > 0
      ? [
          "",
          "```diff",
          ...target.snippet,
          "```",
        ].join("\n")
      : "";

  const suggestionSection = finding.suggestion
    ? formatSuggestionSection(finding.suggestion)
    : "";

  return [header, "", finding.message, snippetSection, suggestionSection]
    .filter(Boolean)
    .join("\n");
}

function scoreInlineConfidence(finding: ReviewFinding, target: InlineTarget): number {
  let score = 0

  if (target.matchedBy === 'quote') {
    score += 0.5
  } else {
    score += 0.25
  }

  if (typeof finding.line === 'number') {
    score += 0.1
  }

  if (finding.quote?.trim()) {
    score += 0.15
  }

  if (finding.suggestion?.trim()) {
    const codeCandidate = extractCodeFromSuggestion(finding.suggestion)
    score += codeCandidate ? 0.2 : 0.05
  }

  return Math.min(1, score)
}

function resolveInlineTarget(
  finding: ReviewFinding,
  patchByPath: Map<string, string>,
  lineMapsByPath: Map<string, DiffLineMaps>,
): InlineTargetResolution {
  const resolvedPatchPath = resolvePatchPath(patchByPath, finding.file)
  if (!resolvedPatchPath) {
    return { ok: false, reason: 'file_not_in_changed_diff' }
  }

  const normalizedPath = resolvedPatchPath.path
  const patch = resolvedPatchPath.patch

  let maps = lineMapsByPath.get(normalizedPath)
  if (!maps) {
    maps = parsePatchLineMaps(patch)
    lineMapsByPath.set(normalizedPath, maps)
  }

  const quotedCode = finding.quote?.trim()
  if (quotedCode) {
    const rightQuotedLine = findLineByQuote(maps.right, quotedCode, finding.line)
    if (typeof rightQuotedLine === 'number') {
      return {
        ok: true,
        target: {
          path: normalizedPath,
          line: rightQuotedLine,
          side: 'RIGHT',
          matchedBy: 'quote',
          snippet: buildSnippet(maps.right, rightQuotedLine),
        },
      }
    }

    const leftQuotedLine = findLineByQuote(maps.left, quotedCode, finding.line)
    if (typeof leftQuotedLine === 'number') {
      return {
        ok: true,
        target: {
          path: normalizedPath,
          line: leftQuotedLine,
          side: 'LEFT',
          matchedBy: 'quote',
          snippet: buildSnippet(maps.left, leftQuotedLine),
        },
      }
    }
  }

  if (typeof finding.line !== 'number') {
    return { ok: false, reason: 'missing_line' }
  }

  const rightLine = maps.right.get(finding.line)
  if (rightLine) {
    return {
      ok: true,
      target: {
        path: normalizedPath,
        line: finding.line,
        side: 'RIGHT',
        matchedBy: 'line',
        snippet: buildSnippet(maps.right, finding.line),
      },
    }
  }

  const leftLine = maps.left.get(finding.line)
  if (leftLine) {
    return {
      ok: true,
      target: {
        path: normalizedPath,
        line: finding.line,
        side: 'LEFT',
        matchedBy: 'line',
        snippet: buildSnippet(maps.left, finding.line),
      },
    }
  }

  return { ok: false, reason: 'line_not_in_changed_hunks' }
}

function buildFallbackSummaryComment(input: {
  totalFindings: number
  postedInline: number
  skippedByReason: Record<string, number>
}): string {
  const skipped = input.totalFindings - input.postedInline
  const reasonLines = Object.entries(input.skippedByReason)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `- ${reason}: ${count}`)

  return [
    REVIEW_COMMENT_MARKER,
    '## Automated PR Review',
    `Inline comments posted: ${input.postedInline}/${input.totalFindings}`,
    skipped > 0 ? 'Skipped findings:' : '',
    skipped > 0 ? reasonLines.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const handlePullRequestEvent = async ({
  payload,
  deliveryId,
  eventName,
}: HandlePullRequestEventArgs): Promise<Response | null> => {
  const body = payload as PullRequestPayload

  if (body.action !== 'opened' && body.action !== 'synchronize' && body.action !== 'reopened') {
    return null
  }

  const installationId = getInstallationId(body.installation)
  const ownerRepo = getOwnerRepo(body.repository)
  const pullRequestNumber = body.pull_request?.number
  const repoFullName = body.repository?.full_name

  console.log(`[webhook] PR ${pullRequestNumber} action=${body.action} installationId=${installationId} repo=${repoFullName}`)

  if (
    !ownerRepo ||
    typeof pullRequestNumber !== 'number' ||
    !Number.isInteger(pullRequestNumber)
  ) {
    console.warn('[github-webhook] pull_request ignored', {
      deliveryId,
      action: body.action,
      installationId,
      owner: ownerRepo?.owner,
      repo: ownerRepo?.repo,
      pullRequestNumber,
      reason: 'missing_or_invalid_review_payload',
    })
    return null
  }

  const effectiveInstallationId = installationId ?? (repoFullName
    ? (await getGithubInstallationByRepoFullName(repoFullName))?.installationId ?? null
    : null)

  if (!effectiveInstallationId) {
    console.warn('[github-webhook] pull_request ignored: no installation found', {
      deliveryId,
      action: body.action,
      installationId,
      repo: repoFullName,
      pullRequestNumber,
    })
    return null
  }

  const githubInstallation = await getGithubInstallationReviewer(effectiveInstallationId)

  let skills: Skill[] = []
  if (githubInstallation) {
    const dbSkills = await prisma.skill.findMany({
      where: { userId: githubInstallation.user.clerkUserId },
      select: { name: true, useCase: true, description: true, content: true, targetAgents: true },
    })
    skills = dbSkills
  }

  if (!githubInstallation) {
    console.warn('[github-webhook] pull_request ignored', {
      deliveryId,
      action: body.action,
      installationId: effectiveInstallationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      reason: 'installation_not_linked_in_db',
    })
    return null
  }

  const [pullRequest, files] = await Promise.all([
    getPullRequest(effectiveInstallationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
    }),
    listPullRequestFiles(effectiveInstallationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
    }),
  ])

  console.log(`[webhook] PR #${pullRequestNumber}: ${files.length} files returned from API`);

  const filesForReview = files
    .filter((file) => typeof file.patch === 'string' && file.patch.length > 0)
    .map((file) => ({
      path: file.filename,
      status: file.status,
      patch: file.patch ?? undefined,
    }))

  console.log(`[webhook] PR #${pullRequestNumber}: ${filesForReview.length} files with patches out of ${files.length}`);

  const initialDiff = filesForReview
    .map((file) => {
      const patch = file.patch ?? ''
      return [
        `diff --git a/${file.path} b/${file.path}`,
        `--- a/${file.path}`,
        `+++ b/${file.path}`,
        patch,
      ].join('\n')
    })
    .join('\n\n')

  const diffSummary = await summarizeDiffWithDefaultModel({
    diff: initialDiff,
  }).catch((error) => {
    console.warn('[github-webhook] diff summarizer failed', {
      deliveryId,
      installationId: effectiveInstallationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      error: error instanceof Error ? error.message : String(error),
    })

    return null
  })

  if (filesForReview.length === 0) {
    console.warn('[github-webhook] pull_request review skipped', {
      deliveryId,
      action: body.action,
      installationId: effectiveInstallationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      reason: 'no_patch_files_available',
    })
    return null
  }

  const pullRequestUrl = body.pull_request?.html_url ?? pullRequest.htmlUrl
  await upsertPullRequestComment(effectiveInstallationId, {
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    pullRequestNumber,
    marker: REVIEW_STATUS_MARKER,
      body: buildReviewStatusComment('in_progress'),
  })

  async function postReviewResults({
    review,
    checkRun,
    effectiveInstallationId: eid,
    ownerRepo: or2,
    pullRequestNumber: prNum,
    pullRequest: pr,
    pullRequestUrl: prUrl2,
    body: body2,
    files: files2,
    githubInstallation: gi,
  }: {
    review: ReviewResult
    checkRun: { id: number } | null
    effectiveInstallationId: number
    ownerRepo: { owner: string; repo: string }
    pullRequestNumber: number
    pullRequest: { number: number; title: string; htmlUrl: string }
    pullRequestUrl: string
    body: PullRequestPayload
    files: Array<{ filename: string; patch?: string | null }>
    githubInstallation: { user: { clerkUserId: string } }
  }) {
    console.info('[github-webhook] AI review completed', {
      deliveryId,
      findingsCount: review.findings.length,
      verdict: review.summary.verdict,
      score: review.summary.score,
      risk: review.summary.risk,
      overviewPreview: review.summary.overview?.slice(0, 200),
    })

    if (checkRun) {
      await updateCheckRun(eid, {
        owner: or2.owner,
        repo: or2.repo,
        checkRunId: checkRun.id,
        status: 'in_progress',
        detailsUrl: prUrl2,
        title: 'Automated PR Review',
        summary: buildCheckSummary(['Analysis complete', 'Publishing comments to GitHub']),
      }).catch(() => {})
    }

    const reviewText = toMarkdownReview(review)
    console.info('[github-webhook] review text generated', {
      reviewTextBytes: reviewText.length,
      reviewTextPreview: reviewText.slice(0, 300),
    })

    const patchByPath = new Map<string, string>()
    for (const file of files2) {
      if (!file.patch) continue
      patchByPath.set(normalizePath(file.filename), file.patch)
    }

    const lineMapsByPath = new Map<string, DiffLineMaps>()
    const skippedByReason: Record<string, number> = {}
    let postedInline = 0
    const inlineTargetStats: Record<string, number> = {}
    const findingStatuses: Array<{ finding: ReviewFinding; postedToGitHub: boolean; skipReason: string | null }> = []
    const commitSha = body2.pull_request?.head?.sha

    console.info('[github-webhook] posting inline comments', {
      totalFindings: review.findings.length,
      hasCommitSha: Boolean(commitSha),
    })

    if (commitSha) {
      for (const finding of review.findings) {
        const targetResolution = resolveInlineTarget(finding, patchByPath, lineMapsByPath)
        if (!targetResolution.ok) {
          skippedByReason[targetResolution.reason] = (skippedByReason[targetResolution.reason] ?? 0) + 1
          findingStatuses.push({ finding, postedToGitHub: false, skipReason: targetResolution.reason })
          continue
        }
        const confidence = scoreInlineConfidence(finding, targetResolution.target)
        inlineTargetStats[`matched_by_${targetResolution.target.matchedBy}`] = (inlineTargetStats[`matched_by_${targetResolution.target.matchedBy}`] ?? 0) + 1
        if (confidence < MIN_INLINE_CONFIDENCE) {
          skippedByReason.low_inline_confidence = (skippedByReason.low_inline_confidence ?? 0) + 1
          findingStatuses.push({ finding, postedToGitHub: false, skipReason: 'low_inline_confidence' })
          continue
        }
        try {
          await createPullRequestReviewComment(eid, {
            owner: or2.owner, repo: or2.repo, pullRequestNumber: prNum, commitSha,
            path: targetResolution.target.path, line: targetResolution.target.line,
            side: targetResolution.target.side, body: buildInlineCommentBody(finding, targetResolution.target),
          })
          postedInline += 1
          findingStatuses.push({ finding, postedToGitHub: true, skipReason: null })
        } catch (commentError) {
          console.warn('[github-webhook] inline comment failed', {
            findingTitle: finding.title, file: finding.file,
            error: commentError instanceof Error ? commentError.message : String(commentError),
          })
          skippedByReason.inline_comment_post_failed = (skippedByReason.inline_comment_post_failed ?? 0) + 1
          findingStatuses.push({ finding, postedToGitHub: false, skipReason: 'inline_comment_post_failed' })
        }
      }
    } else {
      skippedByReason.missing_commit_sha = review.findings.length
      for (const finding of review.findings) {
        findingStatuses.push({ finding, postedToGitHub: false, skipReason: 'missing_commit_sha' })
      }
    }

    if (postedInline < review.findings.length) {
      const fallbackComment = buildFallbackSummaryComment({ totalFindings: review.findings.length, postedInline, skippedByReason })
      await upsertPullRequestComment(eid, {
        owner: or2.owner, repo: or2.repo, pullRequestNumber: prNum,
        marker: REVIEW_COMMENT_MARKER, body: fallbackComment,
      })
    }

    const reviewDbStatus = await savePullRequestReview({
      installationId: eid, repository: body2.repository, ownerRepo: or2,
      pullRequestNumber: pr.number, pullRequestTitle: pr.title, pullRequestUrl: prUrl2,
      prAuthor: body2.pull_request?.user?.login ?? null, prBody: body2.pull_request?.body ?? null,
      headRef: body2.pull_request?.head?.ref ?? pullRequest.headRef, baseRef: body2.pull_request?.base?.ref ?? pullRequest.baseRef,
      prState: body2.pull_request?.state ?? null, prMerged: body2.pull_request?.merged ?? false, prDraft: body2.pull_request?.draft ?? false,
      reviewText, reviewerClerkUserId: gi.user.clerkUserId,
      findings: findingStatuses.map((fs) => ({
        severity: fs.finding.severity, file: fs.finding.file, line: fs.finding.line ?? null,
        quote: fs.finding.quote ?? null, title: fs.finding.title, message: fs.finding.message,
        suggestion: fs.finding.suggestion ?? null, postedToGitHub: fs.postedToGitHub, skipReason: fs.skipReason,
      })),
    })

    console.info('[github-webhook] pull_request review completed', {
      deliveryId, action: body2.action, findingsCount: review.findings.length,
      inlineCommentsPosted: postedInline, skippedByReason, inlineTargetStats, verdict: review.summary.verdict, db: reviewDbStatus,
    })

    if (checkRun) {
      await updateCheckRun(eid, {
        owner: or2.owner, repo: or2.repo, checkRunId: checkRun.id,
        status: 'completed', conclusion: 'success', detailsUrl: prUrl2,
        title: 'Automated PR Review',
        summary: buildCheckSummary(['Review completed', `Findings: ${review.findings.length}`, `Inline comments posted: ${postedInline}`]),
      }).catch(() => {})
    }

    await upsertPullRequestComment(eid, {
      owner: or2.owner, repo: or2.repo, pullRequestNumber: prNum,
      marker: REVIEW_STATUS_MARKER, body: buildReviewStatusComment('completed'),
    })
  }

  const checkRunHeadSha = body.pull_request?.head?.sha
  const checkRun = checkRunHeadSha
    ? await createCheckRun(effectiveInstallationId, {
        owner: ownerRepo.owner,
        repo: ownerRepo.repo,
        name: 'review-agent',
        headSha: checkRunHeadSha,
        detailsUrl: pullRequestUrl,
        title: 'Automated PR Review',
        summary: buildCheckSummary([
          'Review in progress',
          '',
          '[====      ] scanning changed files',
          '[=======   ] tracing impacted code',
          '[==========] generating findings',
        ]),
      }).catch((error) => {
        console.warn('[github-webhook] failed to create review check run', {
          deliveryId,
          installationId: effectiveInstallationId,
          owner: ownerRepo.owner,
          repo: ownerRepo.repo,
          pullRequestNumber,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })
    : null

  try {
    const filesForInput = filesForReview.map((f) => ({ path: f.path, patch: f.patch ?? "" }))

    const review: ReviewResult = await runPullRequestReview({
      installationId: effectiveInstallationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      headRef: body.pull_request?.head?.ref ?? pullRequest.headRef,
      baseRef: body.pull_request?.base?.ref ?? pullRequest.baseRef,
      initialDiff,
      diffSummary: diffSummary ?? undefined,
      files: filesForInput,
    }, { skills })

    await postReviewResults({
      review,
      checkRun,
      effectiveInstallationId,
      ownerRepo,
      pullRequestNumber,
      pullRequest,
      pullRequestUrl,
      body,
      files,
      githubInstallation,
    })
  } catch (error) {
    console.error('[github-webhook] review failed', {
      deliveryId,
      installationId: effectiveInstallationId,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    })

    await upsertPullRequestComment(effectiveInstallationId, {
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      pullRequestNumber,
      marker: REVIEW_STATUS_MARKER,
      body: buildReviewStatusComment('failed'),
    }).catch(() => {})
  }

  return null
}
