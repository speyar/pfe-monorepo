'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useMemo } from 'react'
import useSWR from 'swr'
import fetcher from '@/lib/fetcher'
import { timeAgo } from '@/lib/time-ago'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ExternalLink, GitPullRequest, CheckCircle2, AlertTriangle, FileCode, Code2 } from 'lucide-react'
import type { AppError } from '@/lib/error'
import { cn } from '@/lib/utils'

const statusConfig: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  completed: { label: 'Pass', variant: 'default' },
  failed: { label: 'Fail', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
}

const severityConfig: Record<string, { label: string; color: string; border: string }> = {
  critical: { label: 'Critical', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', border: 'border-l-red-500' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', border: 'border-l-orange-500' },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', border: 'border-l-yellow-500' },
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400', border: 'border-l-gray-400' },
  info: { label: 'Info', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', border: 'border-l-blue-500' },
}

type FindingDetail = {
  id: string
  severity: string
  file: string
  line: number | null
  quote: string | null
  title: string
  message: string
  suggestion: string | null
  postedToGitHub: boolean
  skipReason: string | null
}

type ReviewDetail = {
  id: string
  repoName: string
  repo: string
  prNumber: number
  prTitle: string
  prUrl: string
  status: string
  review: string
  findings: FindingDetail[]
  createdAt: string
  updatedAt: string
}

function MarkdownRenderer({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    let result = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langAttr = lang ? ` class="language-${lang}"` : ''
      return `<pre><code${langAttr}>${code.trim()}</code></pre>`
    })

    result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

    result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>')
    result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>')

    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')

    result = result.replace(/^- (.+)$/gm, '<li>$1</li>')
    result = result.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

    const blocks: string[] = []
    let current = ''
    let inPre = false
    for (const line of result.split('\n')) {
      if (line.startsWith('<pre')) { inPre = true; blocks.push(current.trim()); current = line + '\n'; continue }
      if (inPre) { current += line + '\n'; if (line.startsWith('</pre>')) { inPre = false; blocks.push(current.trim()); current = '' }; continue }
      if (line.trim() === '') { if (current.trim()) blocks.push(current.trim()); current = ''; continue }
      current += (current ? ' ' : '') + line.trim()
    }
    if (current.trim()) blocks.push(current.trim())

    result = blocks.map(b => {
      if (b.startsWith('<h') || b.startsWith('<ul') || b.startsWith('<pre')) return b
      return `<p>${b}</p>`
    }).join('\n')

    return result
  }, [content])

  useEffect(() => {
    const linkId = 'hljs-theme'
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      document.head.appendChild(link)
    }
  }, [])

  useEffect(() => {
    if (ref.current) {
      const hljs = (window as any).hljs
      if (hljs) {
        ref.current.querySelectorAll('pre code').forEach((block) => {
          hljs.highlightElement(block)
        })
      } else {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
        script.onload = () => {
          const hljs = (window as any).hljs
          if (hljs && ref.current) {
            ref.current.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightElement(block)
            })
          }
        }
        document.body.appendChild(script)
      }
    }
  }, [html])

  return (
    <div
      ref={ref}
      className="prose prose-sm max-w-none text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = severityConfig[severity] ?? severityConfig.info
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', cfg.color)}>
      {cfg.label}
    </span>
  )
}

function SuggestionBlock({ code }: { code: string }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border">
      <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <Code2 className="size-3" />
        Suggestion
      </div>
      <pre className="overflow-x-auto bg-[#0d1117] p-3 text-xs text-[#e6edf3]"><code>{code}</code></pre>
    </div>
  )
}

function FindingCard({ finding }: { finding: FindingDetail }) {
  const cfg = severityConfig[finding.severity] ?? severityConfig.info

  return (
    <div className={cn('rounded-lg border border-l-4 bg-card py-3 pl-3 pr-4', cfg.border)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <SeverityBadge severity={finding.severity} />
          {finding.file && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-full">
              <FileCode className="size-3 shrink-0" />
              <span className="truncate">{finding.file}</span>
              {typeof finding.line === 'number' && <span>:{finding.line}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {finding.postedToGitHub ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="size-3" />
              Posted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title={finding.skipReason ?? undefined}>
              <AlertTriangle className="size-3" />
              Not posted
            </span>
          )}
        </div>
      </div>
      {finding.title && (
        <p className="mt-2 text-sm font-medium">{finding.title}</p>
      )}
      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{finding.message}</p>
      {finding.suggestion && <SuggestionBlock code={finding.suggestion} />}
      {!finding.postedToGitHub && finding.skipReason && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Not posted to GitHub — {finding.skipReason.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  )
}

export default function PullDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, isLoading } = useSWR<ReviewDetail, AppError>(
    `/api/pulls/${params.id}`,
    fetcher,
  )

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/pulls')}>
          <ArrowLeft className="size-3 mr-1" />
          Back to Pull Requests
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <GitPullRequest className="size-8 text-destructive/50" />
            <p className="text-sm font-medium text-destructive">Failed to load review</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/pulls')}>
        <ArrowLeft className="size-3 mr-1" />
        Back to Pull Requests
      </Button>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <Badge
                  variant={statusConfig[data.status]?.variant ?? 'secondary'}
                  className="capitalize"
                >
                  {statusConfig[data.status]?.label ?? data.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {data.repoName} #{data.prNumber}
                </span>
              </div>
              <h2 className="text-lg font-semibold">{data.prTitle}</h2>
              <p className="text-sm text-muted-foreground">
                Reviewed {timeAgo(data.createdAt)}
              </p>
            </div>
            <a href={data.prUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                View on GitHub
                <ExternalLink className="size-3 ml-1" />
              </Button>
            </a>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Review Findings</CardTitle>
            </CardHeader>
            <CardContent>
              {data.findings && data.findings.length > 0 ? (
                <div className="space-y-3">
                  {data.findings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </div>
              ) : data.review ? (
                <MarkdownRenderer content={data.review} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No detailed review findings available for this pull request.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
